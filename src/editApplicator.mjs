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
  addCommentToBlock
} from './blockOperations.mjs';

/**
 * @typedef {Object} Author
 * @property {string} name
 * @property {string} email
 */

/**
 * @typedef {Object} Edit
 * @property {'replace'|'delete'|'comment'|'insert'} operation
 * @property {string} [blockId] - For replace, delete, comment
 * @property {string} [afterBlockId] - For insert
 * @property {string} [newText] - For replace
 * @property {string} [text] - For insert
 * @property {string} [comment] - Optional comment
 * @property {boolean} [diff] - Use word-level diff for replace (default: true)
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
 * Validate newText for common truncation and corruption patterns.
 * This helps detect LLM output issues before applying edits.
 *
 * @param {string} originalText - The original block text
 * @param {string} newText - The proposed replacement text
 * @param {Object} options - Validation options
 * @param {number} [options.truncationThreshold=0.5] - Warn if newText is less than this ratio of original
 * @param {number} [options.minLengthForCheck=50] - Only check truncation for texts longer than this
 * @returns {{ valid: boolean, warnings: string[], severity: 'error'|'warning'|'ok' }}
 */
export function validateNewText(originalText, newText, options = {}) {
  const {
    truncationThreshold = 0.5,
    minLengthForCheck = 50
  } = options;

  const warnings = [];
  let severity = 'ok';

  // Skip validation for very short texts or deletions
  if (!newText || newText.length === 0) {
    return { valid: true, warnings: [], severity: 'ok' };
  }

  // Check for significant truncation (but not intentional shortening)
  if (originalText.length >= minLengthForCheck &&
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
    strict = false
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
    const validation = validateEditsAgainstIR(editsToApply, ir, { warnOnTruncation: true });

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

    if (!validation.valid || (strict && validation.warnings && validation.warnings.length > 0)) {
      // Add validation failures to skipped
      for (const issue of validation.issues) {
        results.skipped.push({
          index: issue.editIndex,
          blockId: issue.blockId,
          reason: issue.message
        });
      }
      // Filter out invalid edits
      const invalidIndices = new Set(validation.issues.map(i => i.editIndex));
      editsToApply = editsToApply.filter((_, i) => !invalidIndices.has(i));
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

  const exportedBuffer = await editor.exportDocx(exportOptions);
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
        const commentResult = await addCommentToBlock(editor, blockId, edit.comment, author);
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

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`
        };
    }
  } catch (error) {
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
  const { warnOnTruncation = true } = options;
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

    // Validate operation is known
    const validOperations = ['replace', 'delete', 'comment', 'insert'];
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
        const validation = validateNewText(block.text, edit.newText);
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
  for (const block of ir.blocks) {
    positionMap.set(block.id, block.startPos);
    positionMap.set(block.seqId, block.startPos);
  }

  // Sort by position descending (end of document first)
  return [...edits].sort((a, b) => {
    const posA = positionMap.get(a.blockId || a.afterBlockId) || 0;
    const posB = positionMap.get(b.blockId || b.afterBlockId) || 0;
    return posB - posA; // Descending
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
