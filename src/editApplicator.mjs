/**
 * Edit Applicator - Validates and applies edits to documents.
 *
 * This module orchestrates the edit application workflow:
 * 1. Load document and create editor
 * 2. Extract IR for position resolution
 * 3. Validate edits against IR
 * 4. Sort edits for safe application (descending by position)
 * 5. Apply each edit
 * 6. Export the modified document
 */
import { readFile, writeFile } from 'fs/promises';
import { createHeadlessEditor } from './editorFactory.mjs';
import { extractIRFromEditor } from './irExtractor.mjs';
import {
  replaceBlockById,
  deleteBlockById,
  insertAfterBlock,
  addCommentToBlock,
  insertTextAfterMatch,
  findTextPositionInBlock,
  highlightTextInBlock,
  addCommentToTextInBlock
} from './blockOperations.mjs';

/**
 * @typedef {Object} Author
 * @property {string} name
 * @property {string} email
 */

/**
 * @typedef {Object} Edit
 * @property {'replace'|'delete'|'comment'|'insert'|'insertAfterText'|'highlight'|'commentRange'|'commentHighlight'} operation
 * @property {string} [blockId] - For replace, delete, comment, and text-span operations
 * @property {string} [afterBlockId] - For insert
 * @property {string} [newText] - For replace
 * @property {string} [text] - For insert
 * @property {string} [comment] - Optional comment
 * @property {boolean} [diff] - Use word-level diff for replace (default: true)
 * @property {string} [findText] - Text to locate within block (for text-span operations)
 * @property {string} [insertText] - Text to insert (insertAfterText only)
 * @property {string} [color] - Highlight colour
 * @property {'paragraph'|'heading'|'listItem'} [type] - For insert
 * @property {number} [level] - Heading level for insert
 */

/**
 * @typedef {Object} EditConfig
 * @property {string} [version]
 * @property {Author} [author]
 * @property {Edit[]} edits
 */

/**
 * @typedef {Object} ApplyOptions
 * @property {boolean} trackChanges - Enable track changes mode (default: true)
 * @property {Author} author - Author info for tracked changes
 * @property {boolean} validateFirst - Run validation before applying (default: true)
 * @property {boolean} sortEdits - Auto-sort edits for safe application (default: true)
 * @property {boolean} verbose - Enable verbose logging for debugging position mapping (default: false)
 * @property {boolean} strict - Treat truncation warnings as errors (default: false)
 * @property {boolean} skipInvalid - Skip invalid edits instead of failing (default: false)
 * @property {boolean} allowReduction - Allow intentional content reduction without warning (default: false)
 */

/**
 * @typedef {Object} ApplyResult
 * @property {boolean} success - True if ALL edits applied
 * @property {number} applied - Count of successfully applied edits
 * @property {Array<{index: number, blockId: string, operation?: string, reason: string}>} skipped
 * @property {Array<{index: number, blockId: string, operation: string, diffStats?: object, newBlockId?: string, commentId?: string}>} details
 * @property {Array} comments - Comments data for export
 * @property {Array<{editIndex: number, blockId: string, message: string}>} warnings - Truncation/corruption warnings
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationIssue[]} issues
 * @property {ValidationWarning[]} warnings - Non-blocking warnings (e.g., possible truncation)
 * @property {{totalEdits: number, validEdits: number, invalidEdits: number, warningCount: number}} summary
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {number} editIndex
 * @property {'missing_block'|'missing_field'|'invalid_operation'|'content_corruption'} type
 * @property {string} blockId
 * @property {string} message
 */

/**
 * @typedef {Object} ValidationWarning
 * @property {number} editIndex
 * @property {'content_warning'} type
 * @property {string} blockId
 * @property {string} message
 */

const DEFAULT_AUTHOR = { name: 'AI Assistant', email: 'ai@example.com' };

/**
 * Detect if a block is likely a TOC (Table of Contents) entry.
 * TOC blocks have deeply nested link structures that cause ProseMirror
 * schema validation failures when track changes are applied.
 *
 * @param {Object} block - Block object from IR
 * @returns {boolean}
 */
export function isTocBlock(block) {
  // TOC blocks typically:
  // 1. Have short text (page numbers, short titles)
  // 2. Are near the beginning of the document (b001-b150 range typically)
  // 3. Have text that looks like TOC entries (e.g., "1. Introduction....12")

  const text = block.text || '';

  // Check for TOC-like patterns
  const tocPatterns = [
    /^[\d.]+\s+.{1,50}\.{2,}\s*\d+$/,  // "1.2 Section Name.....12"
    /^\d+\.\s+.{1,30}\t\d+$/,          // "1. Section\t12"
    /^[A-Z][a-z]+\s+\d+$/,             // "Schedule 1"
    /^Part\s+[IVX\d]+/i,               // "Part I", "Part 1"
  ];

  for (const pattern of tocPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a block has complex link nesting that may cause track change failures.
 * This is a deeper check for TOC-like structures.
 *
 * @param {Object} block - Block from IR (with optional _node reference)
 * @returns {{ isToc: boolean, reason?: string }}
 */
export function detectTocStructure(block) {
  const text = block.text || '';

  // Quick pattern-based detection
  if (isTocBlock(block)) {
    return { isToc: true, reason: 'TOC entry pattern detected' };
  }

  // If block is very short and appears to be in early part of document
  // (based on seqId), flag as potential TOC
  if (text.length < 100 && block.seqId) {
    const seqNum = parseInt(block.seqId.replace(/^b/, ''), 10);
    if (seqNum > 0 && seqNum < 150 && /\.{3,}|\t\d+$/.test(text)) {
      return { isToc: true, reason: 'Short text with TOC markers in document front matter' };
    }
  }

  return { isToc: false };
}

/**
 * Validate newText for common truncation and corruption patterns.
 * This helps detect LLM output issues before applying edits.
 *
 * @param {string} originalText - The original block text
 * @param {string} newText - The proposed replacement text
 * @param {Object} options - Validation options
 * @param {number} [options.truncationThreshold=0.5] - Warn if newText is less than this ratio of original
 * @param {number} [options.minLengthForCheck=50] - Only check truncation for texts longer than this
 * @param {boolean} [options.skipReductionWarning=false] - Skip content reduction warnings (for intentional simplifications)
 * @returns {{ valid: boolean, warnings: string[], severity: 'error'|'warning'|'ok' }}
 */
export function validateNewText(originalText, newText, options = {}) {
  const {
    truncationThreshold = 0.5,
    minLengthForCheck = 50,
    skipReductionWarning = false
  } = options;

  const warnings = [];
  let severity = 'ok';

  // Skip validation for very short texts or deletions
  if (!newText || newText.length === 0) {
    return { valid: true, warnings: [], severity: 'ok' };
  }

  // Check for significant truncation (but not intentional shortening)
  // Skip this check if allowReduction is enabled (for jurisdiction conversions, etc.)
  if (!skipReductionWarning &&
      originalText.length >= minLengthForCheck &&
      newText.length < originalText.length * truncationThreshold &&
      newText.length > 20) {
    const reduction = Math.round((1 - newText.length / originalText.length) * 100);
    warnings.push(`Significant content reduction (${reduction}%): ${originalText.length} → ${newText.length} chars`);
    severity = 'warning';
  }

  // Check for incomplete sentences (common truncation pattern)
  if (newText.length > 30) {
    const trimmed = newText.trim();
    const lastChar = trimmed.slice(-1);
    const validEndings = ['.', '!', '?', ')', ']', '"', "'", ':', ';', ',', '-', '—'];

    // Check if ends mid-word (letter followed by nothing)
    if (/[a-zA-Z]$/.test(trimmed) && !validEndings.includes(lastChar)) {
      // Could be intentional (e.g., list item), but flag if original ended properly
      const origTrimmed = originalText.trim();
      const origLastChar = origTrimmed.slice(-1);
      if (validEndings.includes(origLastChar) && origLastChar !== lastChar) {
        warnings.push(`Possible truncation: ends with "${trimmed.slice(-20)}" (original ended with "${origLastChar}")`);
        severity = severity === 'error' ? 'error' : 'warning';
      }
    }
  }

  // Check for content that looks like JSON was cut mid-generation
  // IMPORTANT: Compare with originalText to avoid false positives when the original
  // also has the same pattern (e.g., list items that naturally end with commas)
  const origTrimmed = originalText.trim();
  const newTrimmed = newText.trim();

  const jsonTruncationPatterns = [
    { pattern: /\.\.\.$/, msg: 'Ends with ellipsis (...)' },
    { pattern: /,\s*$/, msg: 'Ends with trailing comma', checkOriginal: true },
    { pattern: /\{\s*$/, msg: 'Ends with opening brace' },
    { pattern: /\[\s*$/, msg: 'Ends with opening bracket' },
    { pattern: /"[^"]*$/, msg: 'Unclosed quote at end' }
  ];

  for (const { pattern, msg, checkOriginal } of jsonTruncationPatterns) {
    if (pattern.test(newText)) {
      // If checkOriginal is true, only flag if original doesn't have the same pattern
      // This prevents false positives for list items that naturally end with commas
      if (checkOriginal && pattern.test(originalText)) {
        // Both original and new text have this pattern - likely intentional
        continue;
      }
      warnings.push(`Likely truncation: ${msg}`);
      severity = 'error';
      break;
    }
  }

  // Check for garbled content (mixed positioning like "4.3S$" pattern)
  // This pattern suggests content from different parts got combined
  const garbledPatterns = [
    { pattern: /\d+\.\d+[A-Z]\$/, msg: 'Suspicious pattern: clause number before currency symbol' },
    { pattern: /\d+\.\d+S\$/, msg: 'Suspicious pattern: number directly before S$' },
    { pattern: /\d+\.\d+£/, msg: 'Suspicious pattern: number directly before £' }
  ];

  for (const { pattern, msg } of garbledPatterns) {
    if (pattern.test(newText) && !pattern.test(originalText)) {
      warnings.push(`Content corruption detected: ${msg}`);
      severity = 'error';
      break;
    }
  }

  return {
    valid: severity !== 'error',
    warnings,
    severity
  };
}

/**
 * Apply all edits to a document and export the result.
 * This is the CORE function that performs the actual document modification.
 *
 * @param {string} inputPath - Path to input DOCX file
 * @param {string} outputPath - Path to output DOCX file
 * @param {EditConfig} editConfig - Edit configuration with edits array
 * @param {ApplyOptions} options - Application options
 * @returns {Promise<ApplyResult>}
 */
export async function applyEdits(inputPath, outputPath, editConfig, options = {}) {
  const {
    trackChanges = true,
    author = editConfig.author || DEFAULT_AUTHOR,
    validateFirst = true,
    sortEdits = true,
    verbose = false,
    strict = false,
    skipInvalid = false,
    allowReduction = false
  } = options;

  const results = {
    success: true,
    applied: 0,
    skipped: [],
    details: [],
    comments: [],
    warnings: []
  };

  // Step 1: Load document and create editor
  const buffer = await readFile(inputPath);
  const editor = await createHeadlessEditor(buffer, {
    documentMode: trackChanges ? 'suggesting' : 'editing',
    user: author
  });

  // Step 2: Extract current IR for position resolution
  const ir = extractDocumentIRFromEditor(editor);

  // Step 3: Validate edits if requested
  let editsToApply = [...editConfig.edits];

  if (validateFirst) {
    const validation = validateEditsAgainstIR(editsToApply, ir, {
      warnOnTruncation: true,
      allowReduction
    });

    // Collect warnings
    if (validation.warnings && validation.warnings.length > 0) {
      for (const warn of validation.warnings) {
        results.warnings.push({
          editIndex: warn.editIndex,
          blockId: warn.blockId,
          message: warn.message
        });
      }
    }

    // In strict mode, treat warnings as errors
    if (strict && validation.warnings && validation.warnings.length > 0) {
      for (const warn of validation.warnings) {
        validation.issues.push({
          editIndex: warn.editIndex,
          type: 'content_warning_strict',
          blockId: warn.blockId,
          message: `[STRICT] ${warn.message}`
        });
      }
    }

    // Handle validation issues (including strict mode warnings added above)
    if (validation.issues.length > 0) {
      // Add validation failures to skipped
      for (const issue of validation.issues) {
        results.skipped.push({
          index: issue.editIndex,
          blockId: issue.blockId,
          reason: issue.message
        });
      }
      // Filter out invalid edits - valid edits will still be applied
      const invalidIndices = new Set(validation.issues.map(i => i.editIndex));
      editsToApply = editsToApply.filter((_, i) => !invalidIndices.has(i));
      // Note: We continue to apply valid edits; success will be set to false at the end
      // The skipInvalid flag only affects CLI exit code, not whether valid edits are applied
    }
  }

  // Step 4: Sort edits for safe application (descending by position)
  if (sortEdits) {
    editsToApply = sortEditsForApplication(editsToApply, ir);
  }

  // Step 5: Apply each edit
  for (let i = 0; i < editsToApply.length; i++) {
    const edit = editsToApply[i];
    const editResult = await applyOneEdit(editor, edit, author, results.comments, ir, { verbose });

    if (editResult.success) {
      results.applied++;
      results.details.push({
        index: i,
        blockId: edit.blockId || edit.afterBlockId,
        operation: edit.operation,
        ...editResult.details
      });
    } else {
      results.skipped.push({
        index: i,
        blockId: edit.blockId || edit.afterBlockId,
        operation: edit.operation,
        reason: editResult.error
      });
    }
  }

  // Step 6: Export the document
  const exportOptions = {
    isFinalDoc: false,
    commentsType: 'external',
  };

  if (results.comments.length > 0) {
    exportOptions.comments = results.comments;
  }

  // Step 6.5: Reset cursor position and suppress TextSelection warning
  // ProseMirror warns when the selection points to an invalid position after bulk edits.
  // This warning is benign and doesn't affect document output, but confuses users.
  try {
    if (editor.commands && editor.commands.setTextSelection) {
      editor.commands.setTextSelection(1);
    } else if (editor.commands && editor.commands.blur) {
      editor.commands.blur();
    }
  } catch (e) {
    // Ignore selection errors - they don't affect document output
  }

  // Temporarily suppress the specific TextSelection warning during export
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const msg = args[0]?.toString() || '';
    if (msg.includes('TextSelection endpoint not pointing into a node with inline content')) {
      // Suppress this specific benign warning
      return;
    }
    originalWarn.apply(console, args);
  };

  let exportedBuffer;
  try {
    exportedBuffer = await editor.exportDocx(exportOptions);
  } finally {
    // Always restore console.warn
    console.warn = originalWarn;
  }
  await writeFile(outputPath, Buffer.from(exportedBuffer));

  // Step 7: Cleanup
  editor.destroy();

  results.success = results.skipped.length === 0;
  return results;
}

/**
 * Resolve a block ID (seqId or UUID) to a UUID using the IR mapping.
 *
 * @param {string} blockId - seqId (e.g., "b001") or UUID
 * @param {DocumentIR} ir - Document IR with blocks
 * @returns {string|null} - Resolved UUID or null if not found
 */
function resolveBlockIdFromIR(blockId, ir) {
  // First check if it's a seqId
  const bySeqId = ir.blocks.find(b => b.seqId === blockId);
  if (bySeqId) {
    return bySeqId.id; // Return the UUID
  }

  // Check if it's a direct UUID
  const byId = ir.blocks.find(b => b.id === blockId);
  if (byId) {
    return byId.id;
  }

  return null;
}

/**
 * Apply a single edit operation.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {Edit} edit - Edit to apply
 * @param {Author} author - Author info
 * @param {Array} commentsStore - Array to collect comments
 * @param {DocumentIR} ir - Document IR for ID resolution
 * @param {Object} options - Additional options
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<{success: boolean, error?: string, details?: object}>}
 */
async function applyOneEdit(editor, edit, author, commentsStore, ir, options = {}) {
  const { verbose = false } = options;
  const { operation } = edit;

  // Resolve the blockId/afterBlockId to UUID using IR
  const blockId = edit.blockId ? resolveBlockIdFromIR(edit.blockId, ir) : null;
  const afterBlockId = edit.afterBlockId ? resolveBlockIdFromIR(edit.afterBlockId, ir) : null;

  // Check resolution succeeded
  if (edit.blockId && !blockId) {
    return { success: false, error: `Block not found: ${edit.blockId}` };
  }
  if (edit.afterBlockId && !afterBlockId) {
    return { success: false, error: `Block not found: ${edit.afterBlockId}` };
  }

  // Pre-check for TOC blocks on replace operations (they fail with cryptic ProseMirror errors)
  // This provides a clear error message instead of letting the operation fail
  if (operation === 'replace' && edit.blockId) {
    const block = ir.blocks.find(b => b.id === blockId || b.seqId === edit.blockId);
    if (block) {
      const tocCheck = detectTocStructure(block);
      if (tocCheck.isToc) {
        return {
          success: false,
          error: `Cannot edit TOC block ${edit.blockId}: ${tocCheck.reason}. ` +
            `TOC blocks have nested link structures that cause track changes to fail. ` +
            `Skip this block and document for manual post-processing. ` +
            `See CONTRACT-REVIEW-SKILL.md "TOC Block Limitations" for details.`
        };
      }
    }
  }

  try {
    switch (operation) {
      case 'replace': {
        const replaceResult = await replaceBlockById(editor, blockId, edit.newText, {
          diff: edit.diff !== false, // Default to diff mode
          trackChanges: true,
          author,
          verbose
        });

        if (replaceResult.success && edit.comment) {
          try {
            const commentResult = await addCommentToBlock(editor, blockId, edit.comment, author);
            if (commentResult.success) {
              commentsStore.push({
                id: commentResult.commentId,
                blockId: blockId,
                text: edit.comment,
                author: author
              });
            }
          } catch (commentError) {
            // Comment failed but replace succeeded - don't fail the entire edit
            console.warn(`Comment failed for block ${edit.blockId}: ${commentError.message}`);
          }
        }

        return {
          success: replaceResult.success,
          error: replaceResult.error,
          details: { diffStats: replaceResult.diffStats }
        };
      }

      case 'delete': {
        const deleteResult = await deleteBlockById(editor, blockId, {
          trackChanges: true,
          author
        });

        // Note: Can't add comment to deleted block

        return {
          success: deleteResult.success,
          error: deleteResult.error
        };
      }

      case 'comment': {
        let commentResult;

        if (edit.findText) {
          // New: range-anchored comment
          commentResult = await addCommentToTextInBlock(editor, blockId, edit.findText, edit.comment, author);

          if (!commentResult.success) {
            // Fallback to full-block comment
            console.warn(`findText "${edit.findText}" not found in block ${edit.blockId}, using full-block comment`);
            commentResult = await addCommentToBlock(editor, blockId, edit.comment, author);
          }
        } else {
          // Legacy: full-block comment (v0.2.0 behaviour)
          commentResult = await addCommentToBlock(editor, blockId, edit.comment, author);
        }

        if (commentResult.success) {
          commentsStore.push({
            id: commentResult.commentId,
            blockId: blockId,
            text: edit.comment,
            author: author
          });
        }

        return {
          success: commentResult.success,
          error: commentResult.error,
          details: { commentId: commentResult.commentId }
        };
      }

      case 'insert': {
        const insertResult = await insertAfterBlock(editor, afterBlockId, edit.text, {
          type: edit.type || 'paragraph',
          level: edit.level,
          trackChanges: true,
          author
        });

        if (insertResult.success && edit.comment) {
          const commentResult = await addCommentToBlock(editor, insertResult.newBlockId, edit.comment, author);
          if (commentResult.success) {
            commentsStore.push({
              id: commentResult.commentId,
              blockId: insertResult.newBlockId,
              text: edit.comment,
              author: author
            });
          }
        }

        return {
          success: insertResult.success,
          error: insertResult.error,
          details: { newBlockId: insertResult.newBlockId }
        };
      }

      case 'insertAfterText': {
        const insertResult = await insertTextAfterMatch(
          editor, blockId, edit.findText, edit.insertText,
          { trackChanges: true, author }
        );

        return {
          success: insertResult.success,
          error: insertResult.error,
          details: {
            findText: edit.findText,
            insertText: edit.insertText,
            insertedAt: insertResult.insertedAt
          }
        };
      }

      case 'highlight': {
        const highlightResult = await highlightTextInBlock(
          editor, blockId, edit.findText, edit.color || '#FFEB3B'
        );

        // Optional: also add comment if provided
        if (highlightResult.success && edit.comment) {
          const commentResult = await addCommentToTextInBlock(
            editor, blockId, edit.findText, edit.comment, author
          );
          if (commentResult.success) {
            commentsStore.push({
              id: commentResult.commentId,
              blockId: blockId,
              text: edit.comment,
              author: author
            });
          }
        }

        return {
          success: highlightResult.success,
          error: highlightResult.error,
          details: { color: edit.color || '#FFEB3B', findText: edit.findText }
        };
      }

      case 'commentRange': {
        const commentResult = await addCommentToTextInBlock(
          editor, blockId, edit.findText, edit.comment, author
        );

        if (commentResult.success) {
          commentsStore.push({
            id: commentResult.commentId,
            blockId: blockId,
            text: edit.comment,
            author: author
          });
        } else {
          // Fallback: full-block comment with warning
          console.warn(`findText not found for commentRange on ${edit.blockId}, falling back to block comment`);
          const fallback = await addCommentToBlock(editor, blockId, edit.comment, author);
          if (fallback.success) {
            commentsStore.push({
              id: fallback.commentId,
              blockId: blockId,
              text: edit.comment,
              author: author
            });
          }
          return {
            success: fallback.success,
            error: fallback.error,
            details: { commentId: fallback.commentId, fallback: true }
          };
        }

        return {
          success: commentResult.success,
          error: commentResult.error,
          details: { commentId: commentResult.commentId, findText: edit.findText }
        };
      }

      case 'commentHighlight': {
        // Step 1: Highlight
        const highlightResult = await highlightTextInBlock(
          editor, blockId, edit.findText, edit.color || '#FFF176'
        );

        if (!highlightResult.success) {
          return { success: false, error: highlightResult.error };
        }

        // Step 2: Comment (on same span)
        const commentResult = await addCommentToTextInBlock(
          editor, blockId, edit.findText, edit.comment, author
        );

        if (commentResult.success) {
          commentsStore.push({
            id: commentResult.commentId,
            blockId: blockId,
            text: edit.comment,
            author: author
          });
        }

        return {
          success: commentResult.success,
          error: commentResult.error,
          details: {
            commentId: commentResult.commentId,
            color: edit.color || '#FFF176',
            findText: edit.findText
          }
        };
      }

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`
        };
    }
  } catch (error) {
    // Check if this is a TOC-related error (nested link structures cause schema validation failures)
    const errorMsg = error.message || String(error);
    if (errorMsg.includes('Invalid content for node') && errorMsg.includes('link')) {
      return {
        success: false,
        error: `TOC block edit failed for ${edit.blockId || edit.afterBlockId}: ` +
          `Block has nested link structures incompatible with track changes. ` +
          `Skip this block and document for manual post-processing. ` +
          `Original error: ${errorMsg}`
      };
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate edits against a document without applying them.
 *
 * @param {string} inputPath - Path to DOCX file
 * @param {EditConfig} editConfig - Edit configuration
 * @returns {Promise<ValidationResult>}
 */
export async function validateEdits(inputPath, editConfig) {
  const buffer = await readFile(inputPath);
  const editor = await createHeadlessEditor(buffer);
  const ir = extractDocumentIRFromEditor(editor);
  editor.destroy();

  return validateEditsAgainstIR(editConfig.edits, ir);
}

/**
 * Validate edits against an already-extracted IR.
 *
 * @param {Edit[]} edits - Array of edits
 * @param {DocumentIR} ir - Document IR
 * @returns {ValidationResult}
 */
export function validateEditsAgainstIR(edits, ir, options = {}) {
  const { warnOnTruncation = true, allowReduction = false } = options;
  const issues = [];
  const warnings = [];
  const blockIdSet = new Set(ir.blocks.map(b => b.id));
  const seqIdSet = new Set(ir.blocks.map(b => b.seqId));

  // Build lookup maps for block content
  const blockById = new Map(ir.blocks.map(b => [b.id, b]));
  const blockBySeqId = new Map(ir.blocks.map(b => [b.seqId, b]));

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const blockId = edit.blockId || edit.afterBlockId;

    // Check if block exists
    if (!blockIdSet.has(blockId) && !seqIdSet.has(blockId)) {
      issues.push({
        editIndex: i,
        type: 'missing_block',
        blockId,
        message: `Block ${blockId} not found in document`
      });
      continue;
    }

    // Validate operation-specific requirements
    if (edit.operation === 'replace' && !edit.newText) {
      issues.push({
        editIndex: i,
        type: 'missing_field',
        blockId,
        message: 'Replace operation requires newText field'
      });
    }

    if (edit.operation === 'comment' && !edit.comment) {
      issues.push({
        editIndex: i,
        type: 'missing_field',
        blockId,
        message: 'Comment operation requires comment field'
      });
    }

    if (edit.operation === 'insert' && !edit.text) {
      issues.push({
        editIndex: i,
        type: 'missing_field',
        blockId,
        message: 'Insert operation requires text field'
      });
    }

    // Validate new operation-specific requirements
    if (['insertAfterText', 'highlight', 'commentRange', 'commentHighlight'].includes(edit.operation) && !edit.findText) {
      issues.push({
        editIndex: i,
        type: 'missing_field',
        blockId,
        message: `${edit.operation} operation requires findText field`
      });
    }

    if (edit.operation === 'insertAfterText' && !edit.insertText) {
      issues.push({
        editIndex: i,
        type: 'missing_field',
        blockId,
        message: `insertAfterText operation requires insertText field`
      });
    }

    if (['commentRange', 'commentHighlight'].includes(edit.operation) && !edit.comment) {
      issues.push({
        editIndex: i,
        type: 'missing_field',
        blockId,
        message: `${edit.operation} operation requires comment field`
      });
    }

    // Validate findText exists in block content (warning only)
    if (edit.findText) {
      const block = blockById.get(blockId) || blockBySeqId.get(blockId);
      if (block && block.text && !block.text.includes(edit.findText)) {
        warnings.push({
          editIndex: i,
          type: 'findtext_warning',
          blockId,
          message: `findText "${edit.findText.slice(0, 40)}${edit.findText.length > 40 ? '...' : ''}" not found in block text`
        });
      }
    }

    // Validate operation is known
    const validOperations = ['replace', 'delete', 'comment', 'insert', 'insertAfterText', 'highlight', 'commentRange', 'commentHighlight'];
    if (!validOperations.includes(edit.operation)) {
      issues.push({
        editIndex: i,
        type: 'invalid_operation',
        blockId,
        message: `Unknown operation: ${edit.operation}`
      });
    }

    // Validate newText for replace operations (check for truncation/corruption)
    if (warnOnTruncation && edit.operation === 'replace' && edit.newText) {
      const block = blockById.get(blockId) || blockBySeqId.get(blockId);
      if (block && block.text) {
        const validation = validateNewText(block.text, edit.newText, {
          skipReductionWarning: allowReduction
        });
        if (!validation.valid) {
          // Errors are blocking issues
          issues.push({
            editIndex: i,
            type: 'content_corruption',
            blockId,
            message: `newText validation failed: ${validation.warnings.join('; ')}`
          });
        } else if (validation.warnings.length > 0) {
          // Warnings are non-blocking but reported
          warnings.push({
            editIndex: i,
            type: 'content_warning',
            blockId,
            message: validation.warnings.join('; ')
          });
        }
      }
    }

    // Check for TOC blocks that may cause track change failures
    if (edit.operation === 'replace') {
      const block = blockById.get(blockId) || blockBySeqId.get(blockId);
      if (block) {
        const tocCheck = detectTocStructure(block);
        if (tocCheck.isToc) {
          warnings.push({
            editIndex: i,
            type: 'toc_warning',
            blockId,
            message: `TOC block detected (${tocCheck.reason}). Track changes may fail due to nested link structures. Consider skipping this block.`
          });
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    summary: {
      totalEdits: edits.length,
      validEdits: edits.length - issues.length,
      invalidEdits: issues.length,
      warningCount: warnings.length
    }
  };
}

/**
 * Extract IR directly from an already-loaded editor.
 * Used internally to avoid reloading the document.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @returns {DocumentIR}
 */
function extractDocumentIRFromEditor(editor) {
  // Use the existing extractIRFromEditor from irExtractor
  // but we can also do a lightweight version here for internal use
  const blocks = [];
  const idMapping = {};
  let seqCounter = 1;

  editor.state.doc.descendants((node, pos) => {
    if (node.isBlock && node.textContent?.trim() && node.attrs.sdBlockId) {
      const seqId = node.attrs.seqId || `b${String(seqCounter).padStart(3, '0')}`;
      blocks.push({
        id: node.attrs.sdBlockId,
        seqId: seqId,
        type: node.type.name,
        text: extractNodeText(node),
        startPos: pos,
        endPos: pos + node.nodeSize
      });
      idMapping[node.attrs.sdBlockId] = seqId;
      seqCounter++;
    }
    return true;
  });

  return { blocks, idMapping };
}

/**
 * Extract text content from a ProseMirror node.
 *
 * @param {Node} node - ProseMirror node
 * @returns {string}
 */
function extractNodeText(node) {
  let text = '';
  if (node.isText) return node.text || '';
  if (node.content && node.content.forEach) {
    node.content.forEach((child) => {
      text += extractNodeText(child);
    });
  }
  return text;
}

/**
 * Sort edits for optimal application order.
 * Edits should be applied from end of document to start
 * to prevent position shifts from affecting later edits.
 *
 * @param {Edit[]} edits - Array of edit objects
 * @param {DocumentIR} ir - Document IR for position lookup
 * @returns {Edit[]} - Sorted edits (descending by position)
 */
export function sortEditsForApplication(edits, ir) {
  // Build position lookup
  const positionMap = new Map();
  const blockTextMap = new Map();
  for (const block of ir.blocks) {
    positionMap.set(block.id, block.startPos);
    positionMap.set(block.seqId, block.startPos);
    if (block.text) {
      blockTextMap.set(block.id, block.text);
      blockTextMap.set(block.seqId, block.text);
    }
  }

  // Sort by position descending (end of document first)
  // Secondary sort: for same block, sort by findText position descending
  return [...edits].sort((a, b) => {
    const posA = positionMap.get(a.blockId || a.afterBlockId) || 0;
    const posB = positionMap.get(b.blockId || b.afterBlockId) || 0;
    if (posB !== posA) return posB - posA; // Primary: block position descending

    // Secondary: for same block, sort by findText position descending
    if (a.findText && b.findText && a.blockId === b.blockId) {
      const blockText = blockTextMap.get(a.blockId) || '';
      const posAText = blockText.indexOf(a.findText);
      const posBText = blockText.indexOf(b.findText);
      return posBText - posAText; // Rightmost findText first
    }

    return 0;
  });
}

/**
 * Load a document and return an editor with its IR.
 * Useful for manual orchestration of edits.
 *
 * @param {string} inputPath - Path to DOCX file
 * @param {Object} options - Editor options
 * @returns {Promise<{editor: Editor, ir: DocumentIR, cleanup: Function}>}
 */
export async function loadDocumentForEditing(inputPath, options = {}) {
  const {
    trackChanges = true,
    author = DEFAULT_AUTHOR
  } = options;

  const buffer = await readFile(inputPath);
  const editor = await createHeadlessEditor(buffer, {
    documentMode: trackChanges ? 'suggesting' : 'editing',
    user: author
  });

  const ir = extractDocumentIRFromEditor(editor);

  return {
    editor,
    ir,
    cleanup: () => editor.destroy()
  };
}

/**
 * Export a modified document.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} outputPath - Path to write output
 * @param {Object} options - Export options
 * @returns {Promise<void>}
 */
export async function exportDocument(editor, outputPath, options = {}) {
  const {
    isFinalDoc = false,
    comments = []
  } = options;

  const exportOptions = {
    isFinalDoc,
    commentsType: 'external',
  };

  if (comments.length > 0) {
    exportOptions.comments = comments;
  }

  const exportedBuffer = await editor.exportDocx(exportOptions);
  await writeFile(outputPath, Buffer.from(exportedBuffer));
}
