#!/usr/bin/env node

/**
 * superdoc-redline.mjs
 *
 * CLI tool for applying tracked changes and comments to DOCX files
 * using SuperDoc in headless (Node.js) mode.
 *
 * Features:
 * - Fuzzy text matching (smart quotes, variable whitespace, markdown)
 * - Occurrence selector (target nth occurrence or all)
 * - Word-level diff (compute minimal tracked changes)
 * - Clause targeting (target by clause number/heading)
 *
 * Usage:
 *   node superdoc-redline.mjs --config edits.json
 *   node superdoc-redline.mjs --inline '{"input":"doc.docx",...}'
 *   node superdoc-redline.mjs --input doc.docx --output out.docx --edits '[...]'
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import { JSDOM } from 'jsdom';
import { Editor, getStarterExtensions } from '@harbour-enterprises/superdoc/super-editor';

// Import new modules
import { findTextFuzzy } from './src/fuzzyMatch.mjs';
import { diffToOperations, getDiffStats } from './src/wordDiff.mjs';
import { buildClauseStructure, findClause, getClauseRange, extractClauseText } from './src/clauseParser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Normalize text by replacing non-breaking spaces with regular spaces.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return text.replace(/\u00a0/g, ' ');
}

/**
 * Build a text index from the ProseMirror document for position mapping.
 * @param {Object} doc - ProseMirror document
 * @returns {{ segments: Array, normalizedText: string }}
 */
function buildTextIndex(doc) {
  const segments = [];
  let total = 0;
  doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text || '';
      segments.push({ text, pos, start: total, end: total + text.length });
      total += text.length;
    }
  });
  const fullText = segments.map((s) => s.text).join('');
  const normalizedText = normalizeText(fullText);
  return { segments, normalizedText };
}

/**
 * Convert a string index to a ProseMirror position.
 * @param {Array} segments - Text segments from buildTextIndex
 * @param {number} index - String index
 * @returns {number|null}
 */
function indexToPos(segments, index) {
  for (const seg of segments) {
    if (index >= seg.start && index < seg.end) {
      const offset = index - seg.start;
      return seg.pos + offset;
    }
  }
  // Handle end-of-segment case
  for (const seg of segments) {
    if (index === seg.end) {
      return seg.pos + seg.text.length;
    }
  }
  return null;
}

/**
 * Find text in the document using fuzzy matching and return ProseMirror positions.
 * @param {Object} editor - SuperDoc Editor instance
 * @param {string} searchText - Text to find
 * @returns {{ from: number, to: number, matchedText: string, matchTier: string } | null}
 */
function findText(editor, searchText) {
  const { segments, normalizedText } = buildTextIndex(editor.state.doc);
  const normalizedSearch = normalizeText(searchText);

  // Use fuzzy matching
  const result = findTextFuzzy(normalizedText, normalizedSearch);

  if (!result) {
    return null;
  }

  // Convert string indices to ProseMirror positions
  const from = indexToPos(segments, result.start);
  const to = indexToPos(segments, result.end);

  if (from === null || to === null) {
    return null;
  }

  return {
    from,
    to,
    matchedText: result.matchedText,
    matchTier: result.tier
  };
}

/**
 * Find all occurrences of search text in the document.
 *
 * @param {Object} editor - SuperDoc Editor instance
 * @param {string} searchText - Text to find
 * @returns {Array<{ from: number, to: number, matchedText: string, occurrenceIndex: number }>}
 */
function findAllMatches(editor, searchText) {
  const { segments, normalizedText } = buildTextIndex(editor.state.doc);
  const normalizedSearch = normalizeText(searchText);

  const matches = [];
  let searchStart = 0;
  let matchIndex = 0;

  while (true) {
    // Use fuzzy matching on remaining text
    const remainingText = normalizedText.slice(searchStart);
    const result = findTextFuzzy(remainingText, normalizedSearch);

    if (!result) break;

    // Adjust positions to account for searchStart offset
    const absoluteStart = result.start + searchStart;
    const absoluteEnd = result.end + searchStart;

    const from = indexToPos(segments, absoluteStart);
    const to = indexToPos(segments, absoluteEnd);

    if (from !== null && to !== null) {
      matches.push({
        from,
        to,
        matchedText: result.matchedText,
        occurrenceIndex: matchIndex++
      });
    }

    // Move search start past this match to find next
    searchStart = absoluteEnd;
  }

  return matches;
}

/**
 * Apply a single edit (replacement with tracked change).
 * @param {Object} editor - SuperDoc Editor instance
 * @param {number} from - Start position
 * @param {number} to - End position
 * @param {string} newText - Replacement text
 */
function applyReplacement(editor, from, to, newText) {
  const tr = editor.state.tr.insertText(newText, from, to);
  // Use editor.view.dispatch if available, otherwise editor.dispatch
  if (editor.view && editor.view.dispatch) {
    editor.view.dispatch(tr);
  } else if (editor.dispatch) {
    editor.dispatch(tr);
  } else {
    throw new Error('Unable to dispatch transaction: no dispatch method found');
  }
}

/**
 * Generate a unique comment ID.
 * @returns {string}
 */
function generateCommentId() {
  return 'comment-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Create ProseMirror-style comment content elements.
 * @param {string} text - Comment text
 * @returns {Array} - ProseMirror content array
 */
function createCommentElements(text) {
  return [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: text }
      ]
    }
  ];
}

/**
 * Add a comment at a text range.
 * @param {Object} editor - SuperDoc Editor instance
 * @param {number} from - Start position
 * @param {number} to - End position
 * @param {string} commentText - Comment content
 * @param {Object} author - Author info { name, email }
 * @param {Array} commentsStore - Array to store comment data for export
 */
function addComment(editor, from, to, commentText, author, commentsStore) {
  const commentId = generateCommentId();

  // Set selection and apply comment mark
  editor.commands.setTextSelection({ from, to });
  editor.chain()
    .setMark('commentMark', {
      commentId: commentId,
      internal: false,
    })
    .run();

  // Create proper ProseMirror-style comment elements
  const elements = createCommentElements(commentText);

  // Store comment data for export with proper structure
  commentsStore.push({
    commentId: commentId,
    elements: elements,
    commentJSON: elements,
    commentText: commentText,
    creatorName: author.name,
    creatorEmail: author.email,
    createdTime: Date.now(),
    resolved: false,
    isInternal: false,
  });
}

/**
 * Build a token map for a range in the document.
 * Maps character positions to ProseMirror positions.
 *
 * @param {Object} editor
 * @param {number} rangeStart - ProseMirror start position
 * @param {number} rangeEnd - ProseMirror end position
 * @returns {{ positionAt: (charIndex: number) => number }}
 */
function buildTokenMap(editor, rangeStart, rangeEnd) {
  const doc = editor.state.doc;
  const tokens = [];
  let charOffset = 0;

  // Walk through the document range
  doc.nodesBetween(rangeStart, rangeEnd, (node, pos) => {
    if (node.isText) {
      const text = node.text || '';
      const startInRange = Math.max(pos, rangeStart);
      const endInRange = Math.min(pos + text.length, rangeEnd);

      if (startInRange < endInRange) {
        const textSlice = text.slice(
          startInRange - pos,
          endInRange - pos
        );

        tokens.push({
          text: textSlice,
          pmPos: startInRange,
          charStart: charOffset,
          charEnd: charOffset + textSlice.length
        });

        charOffset += textSlice.length;
      }
    }
  });

  return {
    positionAt(charIndex) {
      for (const token of tokens) {
        if (charIndex >= token.charStart && charIndex <= token.charEnd) {
          const offset = charIndex - token.charStart;
          return token.pmPos + offset;
        }
      }
      // If at end, return last position
      if (tokens.length > 0) {
        const last = tokens[tokens.length - 1];
        return last.pmPos + last.text.length;
      }
      return rangeStart;
    }
  };
}

/**
 * Apply a diff-type edit using word-level diff.
 *
 * @param {Object} editor - SuperDoc Editor instance
 * @param {Object} edit - Diff edit object
 * @param {Object} author - Author info
 * @param {Array} commentsStore - Comments storage
 * @returns {{ success: boolean, stats: Object, reason?: string }}
 */
function applyDiffEdit(editor, edit, author, commentsStore) {
  const { originalText, newText, comment } = edit;

  // Step 1: Find the original text in the document
  const matchResult = findText(editor, originalText);

  if (!matchResult) {
    return {
      success: false,
      reason: 'Original text not found in document',
      stats: null
    };
  }

  const { from: rangeStart, to: rangeEnd, matchedText } = matchResult;

  // Step 2: Compute word-level diff
  const operations = diffToOperations(matchedText, newText);
  const stats = getDiffStats(matchedText, newText);

  // Step 3: Build token map for the matched range
  const tokenMap = buildTokenMap(editor, rangeStart, rangeEnd);

  // Step 4: Apply operations in reverse order
  const sortedOps = operations
    .map((op, idx) => ({ ...op, idx }))
    .sort((a, b) => b.position - a.position);

  for (const op of sortedOps) {
    if (op.type === 'delete') {
      const from = tokenMap.positionAt(op.position);
      const to = tokenMap.positionAt(op.position + op.text.length);
      applyReplacement(editor, from, to, '');
    } else if (op.type === 'insert') {
      const at = tokenMap.positionAt(op.position);
      applyReplacement(editor, at, at, op.text);
    } else if (op.type === 'replace') {
      const from = tokenMap.positionAt(op.position);
      const to = tokenMap.positionAt(op.position + op.deleteText.length);
      applyReplacement(editor, from, to, op.insertText);
    }
  }

  // Step 5: Add comment if specified
  if (comment) {
    // Re-find the edited range (positions may have shifted)
    const newResult = findText(editor, newText);
    if (newResult) {
      addComment(editor, newResult.from, newResult.to, comment, author, commentsStore);
    }
  }

  return { success: true, stats };
}

/**
 * Apply a clause-type edit.
 *
 * @param {Object} editor - SuperDoc Editor instance
 * @param {Object} edit - Clause edit object
 * @param {Object} author - Author info
 * @param {Array} commentsStore - Comments storage
 * @returns {{ success: boolean, operation?: string, reason?: string }}
 */
function applyClauseEdit(editor, edit, author, commentsStore) {
  const doc = editor.state.doc;

  // Build clause structure
  const { index } = buildClauseStructure(doc);

  // Find target clause
  const clause = findClause(index, {
    number: edit.clauseNumber,
    heading: edit.clauseHeading
  });

  if (!clause) {
    return {
      success: false,
      reason: `Clause not found: ${edit.clauseNumber || edit.clauseHeading}`
    };
  }

  const includeSubclauses = edit.includeSubclauses !== false;
  const { from, to } = getClauseRange(clause, includeSubclauses);

  // Handle different operations
  if (edit.delete === true) {
    // Delete entire clause
    applyReplacement(editor, from, to, '');
    return { success: true, operation: 'delete' };
  }

  if (edit.replace) {
    // Replace clause content
    const currentText = extractClauseText(doc, clause, includeSubclauses);

    if (edit.diff === true) {
      // Use word-level diff
      return applyDiffEdit(editor, {
        originalText: currentText,
        newText: edit.replace,
        comment: edit.comment
      }, author, commentsStore);
    } else {
      // Full replacement
      applyReplacement(editor, from, to, edit.replace);

      if (edit.comment) {
        const newEnd = from + edit.replace.length;
        addComment(editor, from, newEnd, edit.comment, author, commentsStore);
      }

      return { success: true, operation: 'replace' };
    }
  }

  if (edit.insertAfter) {
    // Insert new clause after this one
    const insertPos = to;
    const newText = `\n\n${edit.newClauseNumber || ''} ${edit.text}`;

    applyReplacement(editor, insertPos, insertPos, newText);

    if (edit.comment) {
      addComment(editor, insertPos, insertPos + newText.length, edit.comment, author, commentsStore);
    }

    return { success: true, operation: 'insert' };
  }

  // Comment-only on clause
  if (edit.comment && !edit.replace && !edit.delete) {
    addComment(editor, from, to, edit.comment, author, commentsStore);
    return { success: true, operation: 'comment' };
  }

  return { success: false, reason: 'No valid operation specified' };
}

/**
 * Process all edits on the document.
 * @param {Object} editor - SuperDoc Editor instance
 * @param {Array} edits - Array of edit objects
 * @param {Object} author - Author info
 * @returns {{ applied: number, skipped: Array, comments: Array, details: Array }}
 */
function processEdits(editor, edits, author) {
  const results = {
    applied: 0,
    skipped: [],
    comments: [],
    details: []
  };

  // Collect all operations to apply
  const operations = [];

  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex];

    // Handle different edit types
    if (edit.type === 'diff') {
      // Word-level diff edit - process immediately (complex operation)
      const diffResult = applyDiffEdit(editor, edit, author, results.comments);
      if (diffResult.success) {
        results.applied++;
        results.details.push({
          index: editIndex,
          type: 'diff',
          stats: diffResult.stats
        });
      } else {
        results.skipped.push({
          index: editIndex,
          type: 'diff',
          originalText: (edit.originalText || '').slice(0, 50) + '...',
          reason: diffResult.reason
        });
      }
      continue;
    }

    if (edit.type === 'clause') {
      // Clause-targeted edit - process immediately
      const clauseResult = applyClauseEdit(editor, edit, author, results.comments);
      if (clauseResult.success) {
        results.applied++;
        results.details.push({
          index: editIndex,
          type: 'clause',
          clauseNumber: edit.clauseNumber,
          clauseHeading: edit.clauseHeading,
          operation: clauseResult.operation
        });
      } else {
        results.skipped.push({
          index: editIndex,
          type: 'clause',
          clause: edit.clauseNumber || edit.clauseHeading,
          reason: clauseResult.reason
        });
      }
      continue;
    }

    // Standard find/replace edit with occurrence support
    const { find, replace, comment, occurrence, all } = edit;

    // Find all matches
    const matches = findAllMatches(editor, find);

    if (matches.length === 0) {
      results.skipped.push({
        index: editIndex,
        find,
        reason: 'Text not found',
        occurrencesFound: 0
      });
      continue;
    }

    // Determine which matches to process
    let selectedMatches;

    if (all === true) {
      // Process ALL occurrences
      selectedMatches = matches;
      results.details.push({
        index: editIndex,
        find,
        matchCount: matches.length,
        mode: 'all'
      });
    } else if (typeof occurrence === 'number') {
      // Process specific occurrence (1-indexed)
      if (occurrence < 1 || occurrence > matches.length) {
        results.skipped.push({
          index: editIndex,
          find,
          reason: `Occurrence ${occurrence} not found (only ${matches.length} occurrences exist)`,
          occurrencesFound: matches.length
        });
        continue;
      }
      selectedMatches = [matches[occurrence - 1]];
      results.details.push({
        index: editIndex,
        find,
        matchCount: 1,
        mode: `occurrence-${occurrence}`
      });
    } else {
      // Default: first occurrence
      selectedMatches = [matches[0]];
      results.details.push({
        index: editIndex,
        find,
        matchCount: 1,
        mode: 'first'
      });
    }

    // Queue operations
    for (const match of selectedMatches) {
      operations.push({
        editIndex,
        from: match.from,
        to: match.to,
        matchedText: match.matchedText,
        replace,
        comment,
        author
      });
    }
  }

  // Sort operations by position (descending) to avoid index shifting
  operations.sort((a, b) => b.from - a.from);

  // Apply operations
  for (const op of operations) {
    const { from, to, replace, comment, author: opAuthor } = op;

    if (replace !== undefined) {
      applyReplacement(editor, from, to, replace);

      if (comment) {
        const newTo = from + replace.length;
        addComment(editor, from, newTo > from ? newTo : from + 1, comment, opAuthor, results.comments);
      }
    } else if (comment) {
      addComment(editor, from, to, comment, opAuthor, results.comments);
    }

    results.applied++;
  }

  return results;
}

/**
 * Main function to load, edit, and export a DOCX file.
 * @param {Object} config - Configuration object
 */
async function processDocument(config) {
  const { input, output, author, edits } = config;

  // Validate input file exists
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Set up JSDOM for headless mode
  const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const { document } = window;

  console.log(`Loading document: ${inputPath}`);

  // Read the DOCX file
  const buffer = await readFile(inputPath);

  // Parse DOCX data (pass true as second arg for Node.js)
  const [content, media, mediaFiles, fonts] = await Editor.loadXmlData(buffer, true);

  // Create editor in suggesting mode (track changes)
  const editor = new Editor({
    mode: 'docx',
    documentMode: 'suggesting',
    documentId: 'redline-doc',
    element: document.createElement('div'),
    extensions: getStarterExtensions(),
    fileSource: buffer,
    content,
    media,
    mediaFiles,
    fonts,
    isHeadless: true,
    document: document,
    user: {
      name: author.name,
      email: author.email,
    },
  });

  console.log(`Processing ${edits.length} edit(s)...`);

  // Process all edits
  const results = processEdits(editor, edits, author);

  console.log(`Applied: ${results.applied}, Skipped: ${results.skipped.length}`);
  if (results.comments.length > 0) {
    console.log(`Comments added: ${results.comments.length}`);
  }

  if (results.skipped.length > 0) {
    console.log('Skipped edits:');
    for (const skip of results.skipped) {
      console.log(`  [${skip.index}] "${skip.find || skip.clause || skip.originalText || 'unknown'}" - ${skip.reason}`);
    }
  }

  // Export the document
  console.log(`Exporting to: ${output}`);
  const exportOptions = {
    isFinalDoc: false,
    commentsType: 'external',
  };

  // Include comments data if any were added
  if (results.comments.length > 0) {
    exportOptions.comments = results.comments;
  }

  const result = await editor.exportDocx(exportOptions);

  // Handle different return types (Blob in browser, Buffer/Uint8Array in Node)
  let outputBuffer;
  if (Buffer.isBuffer(result)) {
    outputBuffer = result;
  } else if (result instanceof Uint8Array) {
    outputBuffer = Buffer.from(result);
  } else if (result && typeof result.arrayBuffer === 'function') {
    const arrayBuffer = await result.arrayBuffer();
    outputBuffer = Buffer.from(arrayBuffer);
  } else if (result && result.type === 'Buffer' && Array.isArray(result.data)) {
    outputBuffer = Buffer.from(result.data);
  } else {
    outputBuffer = Buffer.from(result);
  }

  const outputPath = resolve(output);
  await writeFile(outputPath, outputBuffer);

  console.log('Done!');

  // Cleanup
  editor.destroy();

  return results;
}

/**
 * Parse configuration from various input sources.
 * @param {Object} options - Commander options
 * @returns {Object} - Parsed configuration
 */
async function parseConfig(options) {
  let config;

  if (options.config) {
    const configPath = resolve(options.config);
    const configText = await readFile(configPath, 'utf-8');
    config = JSON.parse(configText);
  } else if (options.inline) {
    config = JSON.parse(options.inline);
  } else if (options.input && options.output && options.edits) {
    config = {
      input: options.input,
      output: options.output,
      author: {
        name: options.authorName || 'AI Assistant',
        email: options.authorEmail || 'ai@example.com',
      },
      edits: JSON.parse(options.edits),
    };
  } else {
    throw new Error('Must provide --config, --inline, or (--input, --output, --edits)');
  }

  // Validate required fields
  if (!config.input) throw new Error('Missing "input" field');
  if (!config.output) throw new Error('Missing "output" field');
  if (!config.edits || !Array.isArray(config.edits)) {
    throw new Error('Missing or invalid "edits" array');
  }

  // Set default author if not provided
  config.author = config.author || {};
  config.author.name = config.author.name || 'AI Assistant';
  config.author.email = config.author.email || 'ai@example.com';

  return config;
}

// CLI setup
program
  .name('superdoc-redline')
  .description('Apply tracked changes and comments to DOCX files')
  .version('1.0.0')
  .option('-c, --config <path>', 'Path to JSON config file')
  .option('-i, --inline <json>', 'Inline JSON configuration')
  .option('--input <path>', 'Input DOCX file path')
  .option('--output <path>', 'Output DOCX file path')
  .option('--author-name <name>', 'Author name for track changes', 'AI Assistant')
  .option('--author-email <email>', 'Author email for track changes', 'ai@example.com')
  .option('--edits <json>', 'JSON array of edits')
  .action(async (options) => {
    try {
      const config = await parseConfig(options);
      await processDocument(config);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
