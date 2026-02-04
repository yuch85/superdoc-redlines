/**
 * Block Operations - ID-based document editing operations.
 *
 * Provides operations for replacing, deleting, inserting, and commenting
 * on document blocks using stable block IDs (UUID or seqId).
 */
import { computeWordDiff, diffToOperations } from './wordDiff.mjs';

/**
 * @typedef {Object} Author
 * @property {string} name - Author name
 * @property {string} email - Author email
 */

/**
 * @typedef {Object} OperationResult
 * @property {boolean} success
 * @property {'replace'|'delete'|'insert'|'comment'} [operation]
 * @property {string} [blockId]
 * @property {string} [newBlockId] - For insert operations
 * @property {string} [commentId] - For comment operations
 * @property {string} [error]
 * @property {{ insertions: number, deletions: number, unchanged: number }} [diffStats]
 */

const DEFAULT_AUTHOR = { name: 'AI Assistant', email: 'ai@example.com' };

/**
 * Resolve a block ID (could be UUID or seqId) to a UUID.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId (e.g., "b001")
 * @returns {string|null} - Resolved UUID or null if not found
 */
export function resolveBlockId(editor, blockId) {
  // If it looks like a seqId (e.g., "b001"), look up the UUID
  if (/^b\d+$/i.test(blockId)) {
    // Search for block with matching seqId attribute
    let foundId = null;
    editor.state.doc.descendants((node) => {
      if (node.attrs.seqId === blockId) {
        foundId = node.attrs.sdBlockId;
        return false; // Stop traversal
      }
      return true;
    });
    return foundId;
  }

  // Assume it's already a UUID - verify it exists
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.attrs.sdBlockId === blockId) {
      found = true;
      return false;
    }
    return true;
  });

  return found ? blockId : null;
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
 * Generate a unique comment ID.
 * @returns {string}
 */
function generateCommentId() {
  return 'comment-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

/**
 * Get block info by ID using SuperDoc's helper or manual traversal.
 *
 * @param {Editor} editor
 * @param {string} uuid - Block UUID
 * @returns {{ node: Node, pos: number }|null}
 */
function getBlockInfo(editor, uuid) {
  // Try SuperDoc's native helper first
  if (editor.helpers?.blockNode?.getBlockNodeById) {
    const result = editor.helpers.blockNode.getBlockNodeById(uuid);
    if (result && result.length > 0) {
      return result[0];
    }
  }

  // Fallback to manual traversal
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.sdBlockId === uuid) {
      found = { node, pos };
      return false;
    }
    return true;
  });

  return found;
}

/**
 * Find the editor position of a specific text within a block.
 * This handles variable node structures (multiple runs, bookmarks, etc.)
 * where the offset from block position varies throughout the block.
 *
 * @param {Editor} editor - Editor instance
 * @param {number} blockPos - Block position in document
 * @param {number} blockSize - Block node size
 * @param {string} searchText - The exact text to find
 * @returns {number|null} - Editor position where text starts, or null if not found
 */
function findTextInBlock(editor, blockPos, blockSize, searchText) {
  const searchLen = searchText.length;
  const maxPos = blockPos + blockSize;
  
  for (let pos = blockPos; pos < maxPos - searchLen; pos++) {
    try {
      const text = editor.state.doc.textBetween(pos, pos + searchLen);
      if (text === searchText) {
        return pos;
      }
    } catch (e) {
      // Position might be at a node boundary, continue
    }
  }
  
  return null;
}

/**
 * Validate a position map for correctness.
 * Checks for undefined entries and monotonically increasing values.
 *
 * @param {number[]} map - Position map to validate
 * @param {string} blockText - The text that was mapped
 * @returns {{ valid: boolean, errors: string[], undefinedCount: number, firstUndefined: number }}
 */
function validatePositionMap(map, blockText) {
  const errors = [];
  let undefinedCount = 0;
  let firstUndefined = -1;
  let prevPos = -1;

  for (let i = 0; i < map.length; i++) {
    if (map[i] === undefined) {
      undefinedCount++;
      if (firstUndefined === -1) {
        firstUndefined = i;
        errors.push(`Undefined entry at textPos ${i} (char: '${blockText[i]}')`);
      }
    } else {
      if (prevPos !== -1 && map[i] <= prevPos) {
        errors.push(`Non-monotonic: map[${i}]=${map[i]} <= map[${i - 1}]=${prevPos}`);
      }
      prevPos = map[i];
    }
  }

  return {
    valid: undefinedCount === 0 && errors.length === 0,
    errors,
    undefinedCount,
    firstUndefined
  };
}

/**
 * Build a mapping from text positions to editor positions for a block.
 * This handles blocks with complex internal structure (multiple runs, bookmarks).
 *
 * @param {Editor} editor - Editor instance
 * @param {number} blockPos - Block position in document
 * @param {string} blockText - The full text content of the block
 * @param {number} blockSize - Block node size
 * @param {Object} options - Options
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {{ map: number[], validation: { valid: boolean, errors: string[], undefinedCount: number, firstUndefined: number } }}
 */
function buildPositionMap(editor, blockPos, blockText, blockSize, options = {}) {
  const { verbose = false } = options;
  const map = new Array(blockText.length);
  let editorPos = blockPos;
  let textPos = 0;

  if (verbose) {
    console.log(`[buildPositionMap] Building map for block at pos ${blockPos}`);
    console.log(`  Text length: ${blockText.length}, Block size: ${blockSize}`);
    console.log(`  Text preview: "${blockText.slice(0, 50)}${blockText.length > 50 ? '...' : ''}"`);
  }

  // Walk through finding each character
  while (textPos < blockText.length && editorPos < blockPos + blockSize) {
    try {
      const char = editor.state.doc.textBetween(editorPos, editorPos + 1);
      if (char === blockText[textPos]) {
        map[textPos] = editorPos;
        if (verbose && textPos < 10) {
          console.log(`  textPos ${textPos} ('${blockText[textPos]}') -> editorPos ${editorPos}`);
        }
        textPos++;
      }
      editorPos++;
    } catch (e) {
      editorPos++;
    }
  }

  // Validate the map
  const validation = validatePositionMap(map, blockText);

  if (verbose) {
    console.log(`  Mapped ${textPos} of ${blockText.length} characters`);
    console.log(`  Validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);
    if (!validation.valid) {
      console.log(`  Errors: ${validation.errors.slice(0, 3).join('; ')}${validation.errors.length > 3 ? '...' : ''}`);
    }
  }

  // For backwards compatibility, return just the map array
  // But attach validation as a property
  map._validation = validation;

  return map;
}

/**
 * Apply word-level diff to produce minimal tracked changes.
 *
 * CRITICAL FIX: Operations must be applied in REVERSE order (end-to-start)
 * to prevent position corruption. When we apply from end to start:
 * - Later positions are modified first
 * - Earlier positions remain valid (content before them is unchanged)
 * - No complex offset tracking needed
 *
 * Additionally, each operation is applied atomically using chain().run()
 * to ensure the document state is fully updated before the next operation.
 *
 * @param {Editor} editor
 * @param {number} pos - Block position
 * @param {Node} node - Block node
 * @param {string} originalText - Current text
 * @param {string} newText - Target text
 * @param {Author} author
 * @param {string|null} comment
 * @param {Object} options - Options
 * @param {boolean} [options.verbose=false] - Enable verbose logging for debugging
 * @returns {OperationResult}
 */
function applyWordDiff(editor, pos, node, originalText, newText, author, comment, options = {}) {
  const { verbose = false } = options;
  const blockId = node.attrs.sdBlockId || node.attrs.seqId || 'unknown';

  if (verbose) {
    console.log(`\n[applyWordDiff] Block ${blockId}`);
    console.log(`  Original (${originalText.length} chars): "${originalText.slice(0, 80)}${originalText.length > 80 ? '...' : ''}"`);
    console.log(`  New (${newText.length} chars): "${newText.slice(0, 80)}${newText.length > 80 ? '...' : ''}"`);
  }

  const operations = diffToOperations(originalText, newText);

  if (verbose) {
    console.log(`  Operations (${operations.length}):`);
    for (const op of operations) {
      if (op.type === 'replace') {
        console.log(`    REPLACE at ${op.position}: "${op.deleteText.slice(0, 30)}${op.deleteText.length > 30 ? '...' : ''}" -> "${op.insertText.slice(0, 30)}${op.insertText.length > 30 ? '...' : ''}"`);
      } else if (op.type === 'delete') {
        console.log(`    DELETE at ${op.position}: "${op.text.slice(0, 40)}${op.text.length > 40 ? '...' : ''}"`);
      } else if (op.type === 'insert') {
        console.log(`    INSERT at ${op.position}: "${op.text.slice(0, 40)}${op.text.length > 40 ? '...' : ''}"`);
      }
    }
  }

  let stats = { insertions: 0, deletions: 0, unchanged: 0 };

  // Build a complete position map for the block
  // This handles complex node structures with multiple runs, bookmarks, etc.
  const positionMap = buildPositionMap(editor, pos, originalText, node.nodeSize, { verbose });

  // Check position map validation
  const validation = positionMap._validation;
  if (validation && !validation.valid) {
    console.warn(`[applyWordDiff] Position map validation failed for block ${blockId}:`);
    console.warn(`  Undefined entries: ${validation.undefinedCount}`);
    console.warn(`  First undefined at textPos ${validation.firstUndefined}`);
    if (validation.errors.length > 0) {
      console.warn(`  Errors: ${validation.errors.slice(0, 3).join('; ')}`);
    }
  }

  // CRITICAL: Sort operations by position in DESCENDING order (end-to-start)
  // This ensures earlier positions remain valid as we modify from the end
  const sortedOps = [...operations].sort((a, b) => b.position - a.position);

  if (verbose) {
    console.log(`  Applying ${sortedOps.length} operations (sorted end-to-start):`);
  }

  for (const op of sortedOps) {
    // Apply each operation atomically - the operation completes fully
    // before we move to the next one. Since we're going end-to-start,
    // the position for this operation is still valid.

    let success = true;

    if (op.type === 'delete') {
      // Use position map to get actual editor positions
      const from = positionMap[op.position];
      const toTextPos = op.position + op.text.length - 1;
      const to = positionMap[toTextPos] !== undefined ? positionMap[toTextPos] + 1 : undefined;

      if (verbose) {
        console.log(`    DELETE: textPos [${op.position}, ${toTextPos}] -> editorPos [${from}, ${to})`);
        console.log(`      Text: "${op.text.slice(0, 40)}${op.text.length > 40 ? '...' : ''}"`);
      }

      if (from === undefined || to === undefined) {
        const errMsg = `Could not map text position ${op.position} or ${toTextPos} to editor position (from=${from}, to=${to}). ` +
          `Text to delete: "${op.text.slice(0, 30)}${op.text.length > 30 ? '...' : ''}"`;
        console.error(`[applyWordDiff] ${errMsg}`);
        return {
          success: false,
          error: errMsg,
          blockId: node.attrs.sdBlockId
        };
      }

      // Use chain().run() for atomic execution if available
      if (editor.chain) {
        success = editor.chain()
          .setTextSelection({ from, to })
          .deleteSelection()
          .run();
      } else {
        editor.commands.setTextSelection({ from, to });
        editor.commands.deleteSelection();
      }

      stats.deletions++;
    } else if (op.type === 'insert') {
      // For insert, use the position just before or at the insertion point
      const insertAt = positionMap[op.position] ??
        (op.position > 0 && positionMap[op.position - 1] !== undefined
          ? positionMap[op.position - 1] + 1
          : undefined);

      if (verbose) {
        console.log(`    INSERT: textPos ${op.position} -> editorPos ${insertAt}`);
        console.log(`      Text: "${op.text.slice(0, 40)}${op.text.length > 40 ? '...' : ''}"`);
      }

      if (insertAt === undefined) {
        const errMsg = `Could not map text position ${op.position} to editor position for insert. ` +
          `Text to insert: "${op.text.slice(0, 30)}${op.text.length > 30 ? '...' : ''}"`;
        console.error(`[applyWordDiff] ${errMsg}`);
        return {
          success: false,
          error: errMsg,
          blockId: node.attrs.sdBlockId
        };
      }

      // Use chain().run() for atomic execution if available
      if (editor.chain) {
        success = editor.chain()
          .setTextSelection({ from: insertAt, to: insertAt })
          .insertContent(op.text)
          .run();
      } else {
        editor.commands.setTextSelection({ from: insertAt, to: insertAt });
        editor.commands.insertContent(op.text);
      }

      stats.insertions++;
    } else if (op.type === 'replace') {
      // Use position map to get actual editor positions
      const from = positionMap[op.position];
      const toTextPos = op.position + op.deleteText.length - 1;
      const to = positionMap[toTextPos] !== undefined ? positionMap[toTextPos] + 1 : undefined;

      if (verbose) {
        console.log(`    REPLACE: textPos [${op.position}, ${toTextPos}] -> editorPos [${from}, ${to})`);
        console.log(`      Delete: "${op.deleteText.slice(0, 30)}${op.deleteText.length > 30 ? '...' : ''}"`);
        console.log(`      Insert: "${op.insertText.slice(0, 30)}${op.insertText.length > 30 ? '...' : ''}"`);
      }

      if (from === undefined || to === undefined) {
        const errMsg = `Could not map text position ${op.position} or ${toTextPos} to editor position (from=${from}, to=${to}). ` +
          `Replace "${op.deleteText.slice(0, 20)}..." with "${op.insertText.slice(0, 20)}..."`;
        console.error(`[applyWordDiff] ${errMsg}`);
        return {
          success: false,
          error: errMsg,
          blockId: node.attrs.sdBlockId
        };
      }

      // Use chain().run() for atomic execution if available
      if (editor.chain) {
        success = editor.chain()
          .setTextSelection({ from, to })
          .insertContent(op.insertText)
          .run();
      } else {
        editor.commands.setTextSelection({ from, to });
        editor.commands.insertContent(op.insertText);
      }

      stats.deletions++;
      stats.insertions++;
    }

    // If any operation fails (e.g., schema validation error), signal failure
    if (!success) {
      const errMsg = `Word diff operation ${op.type} failed at text position ${op.position}`;
      console.error(`[applyWordDiff] ${errMsg}`);
      return {
        success: false,
        error: errMsg,
        blockId: node.attrs.sdBlockId
      };
    }

    if (verbose) {
      console.log(`      -> Success`);
    }
  }

  // Count unchanged (rough estimate based on operations)
  stats.unchanged = operations.length === 0 ? 1 : 0;

  return {
    success: true,
    operation: 'replace',
    blockId: node.attrs.sdBlockId,
    diffStats: stats
  };
}

/**
 * Replace entire block content (no diff).
 *
 * @param {Editor} editor
 * @param {number} pos - Block position
 * @param {Node} node - Block node
 * @param {string} newText - Replacement text
 * @param {Author} author
 * @param {string|null} comment
 * @returns {OperationResult}
 */
function applyFullReplace(editor, pos, node, newText, author, comment) {
  // Build position map to find actual content boundaries
  const originalText = extractNodeText(node);
  const positionMap = buildPositionMap(editor, pos, originalText, node.nodeSize);
  
  // Get from (first char) and to (after last char)
  const from = positionMap[0];
  const to = positionMap[originalText.length - 1] + 1;
  
  if (from === undefined || to === undefined) {
    return {
      success: false,
      error: 'Could not determine content boundaries',
      blockId: node.attrs.sdBlockId
    };
  }

  // Select all content and replace
  editor.commands.setTextSelection({ from, to });
  editor.commands.insertContent(newText);

  return {
    success: true,
    operation: 'replace',
    blockId: node.attrs.sdBlockId
  };
}

/**
 * Replace a block's content by its ID.
 * Supports word-level diff for minimal tracked changes.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @param {string} newText - Replacement text
 * @param {Object} options
 * @param {boolean} [options.diff=true] - Use word-level diff
 * @param {boolean} [options.trackChanges=true] - Enable track changes
 * @param {string} [options.comment=null] - Optional comment to attach
 * @param {Author} [options.author] - Author info for track changes
 * @param {boolean} [options.verbose=false] - Enable verbose logging for debugging
 * @returns {Promise<OperationResult>}
 */
export async function replaceBlockById(editor, blockId, newText, options = {}) {
  const {
    diff = true,
    trackChanges = true,
    comment = null,
    author = DEFAULT_AUTHOR,
    verbose = false
  } = options;

  // Resolve blockId (could be UUID or seqId)
  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }

  // Enable track changes mode
  if (trackChanges && editor.setDocumentMode) {
    editor.setDocumentMode('suggesting');
  }

  // Get current block content
  const blockInfo = getBlockInfo(editor, resolvedId);
  if (!blockInfo) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }

  const { node, pos } = blockInfo;
  const originalText = extractNodeText(node);

  if (diff) {
    // Apply word-level diff with fallback to full replacement on failure
    try {
      const diffResult = applyWordDiff(editor, pos, node, originalText, newText, author, comment, { verbose });

      if (!diffResult.success) {
        // Word diff failed (e.g., schema validation error on small insertions) - fall back to full replacement
        console.warn(`Word diff failed for block ${blockId}, using full replacement: ${diffResult.error}`);
        return applyFullReplace(editor, pos, node, newText, author, comment);
      }

      return diffResult;
    } catch (error) {
      // Exception thrown during word diff (e.g., schema validation) - fall back to full replacement
      console.warn(`Word diff threw error for block ${blockId}, using full replacement: ${error.message}`);
      return applyFullReplace(editor, pos, node, newText, author, comment);
    }
  } else {
    // Full replacement
    return applyFullReplace(editor, pos, node, newText, author, comment);
  }
}

/**
 * Delete a block by its ID.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @param {Object} options
 * @param {boolean} [options.trackChanges=true] - Enable track changes
 * @param {string} [options.comment=null] - Optional comment explaining deletion
 * @param {Author} [options.author] - Author info
 * @returns {Promise<OperationResult>}
 */
export async function deleteBlockById(editor, blockId, options = {}) {
  const {
    trackChanges = true,
    comment = null,
    author = DEFAULT_AUTHOR
  } = options;

  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }

  // Enable track changes mode
  if (trackChanges && editor.setDocumentMode) {
    editor.setDocumentMode('suggesting');
  }

  // Try SuperDoc's native command first
  if (editor.commands?.deleteBlockNodeById) {
    const success = editor.commands.deleteBlockNodeById(resolvedId);
    return {
      success,
      operation: 'delete',
      blockId: resolvedId
    };
  }

  // Fallback: manual deletion using transaction
  const blockInfo = getBlockInfo(editor, resolvedId);
  if (!blockInfo) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }

  const { node, pos } = blockInfo;
  const tr = editor.state.tr.delete(pos, pos + node.nodeSize);

  if (editor.view?.dispatch) {
    editor.view.dispatch(tr);
  } else if (editor.dispatch) {
    editor.dispatch(tr);
  }

  return {
    success: true,
    operation: 'delete',
    blockId: resolvedId
  };
}

/**
 * Create a new ProseMirror node.
 *
 * @param {Editor} editor
 * @param {'paragraph'|'heading'|'listItem'} type
 * @param {string} text
 * @param {Object} options
 * @returns {Node}
 */
function createNode(editor, type, text, options = {}) {
  const { schema } = editor.state;
  const nodeTypeName = type === 'heading' ? 'heading' : 'paragraph';
  const nodeType = schema.nodes[nodeTypeName];

  if (!nodeType) {
    // Fallback to paragraph if type not found
    return schema.nodes.paragraph.create(
      { sdBlockId: crypto.randomUUID() },
      text ? schema.text(text) : null
    );
  }

  const attrs = {
    sdBlockId: crypto.randomUUID()
  };

  if (type === 'heading' && options.level) {
    attrs.level = options.level;
  }

  return nodeType.create(attrs, text ? schema.text(text) : null);
}

/**
 * Insert a new block after an existing block.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} afterBlockId - UUID or seqId of reference block
 * @param {string} text - Content for new block
 * @param {Object} options
 * @param {'paragraph'|'heading'|'listItem'} [options.type='paragraph'] - Block type
 * @param {number} [options.level=1] - Heading level if type is 'heading'
 * @param {boolean} [options.trackChanges=true] - Enable track changes
 * @param {string} [options.comment=null] - Optional comment
 * @param {Author} [options.author] - Author info
 * @returns {Promise<OperationResult>}
 */
export async function insertAfterBlock(editor, afterBlockId, text, options = {}) {
  const {
    type = 'paragraph',
    level = 1,
    trackChanges = true,
    comment = null,
    author = DEFAULT_AUTHOR
  } = options;

  const resolvedId = resolveBlockId(editor, afterBlockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${afterBlockId}` };
  }

  // Enable track changes mode
  if (trackChanges && editor.setDocumentMode) {
    editor.setDocumentMode('suggesting');
  }

  // Get target block position
  const blockInfo = getBlockInfo(editor, resolvedId);
  if (!blockInfo) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }

  const { node, pos } = blockInfo;
  const insertPos = pos + node.nodeSize;

  // Create new node
  const newNode = createNode(editor, type, text, { level });
  const newBlockId = newNode.attrs.sdBlockId;

  // Insert using transaction
  const tr = editor.state.tr.insert(insertPos, newNode);

  if (editor.view?.dispatch) {
    editor.view.dispatch(tr);
  } else if (editor.dispatch) {
    editor.dispatch(tr);
  }

  return {
    success: true,
    operation: 'insert',
    afterBlockId: resolvedId,
    newBlockId: newBlockId
  };
}

/**
 * Insert a new block before an existing block.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} beforeBlockId - UUID or seqId of reference block
 * @param {string} text - Content for new block
 * @param {Object} options
 * @param {'paragraph'|'heading'|'listItem'} [options.type='paragraph'] - Block type
 * @param {number} [options.level=1] - Heading level if type is 'heading'
 * @param {boolean} [options.trackChanges=true] - Enable track changes
 * @param {string} [options.comment=null] - Optional comment
 * @param {Author} [options.author] - Author info
 * @returns {Promise<OperationResult>}
 */
export async function insertBeforeBlock(editor, beforeBlockId, text, options = {}) {
  const {
    type = 'paragraph',
    level = 1,
    trackChanges = true,
    comment = null,
    author = DEFAULT_AUTHOR
  } = options;

  const resolvedId = resolveBlockId(editor, beforeBlockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${beforeBlockId}` };
  }

  // Enable track changes mode
  if (trackChanges && editor.setDocumentMode) {
    editor.setDocumentMode('suggesting');
  }

  // Get target block position
  const blockInfo = getBlockInfo(editor, resolvedId);
  if (!blockInfo) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }

  const { pos } = blockInfo;

  // Create new node
  const newNode = createNode(editor, type, text, { level });
  const newBlockId = newNode.attrs.sdBlockId;

  // Insert before the target block
  const tr = editor.state.tr.insert(pos, newNode);

  if (editor.view?.dispatch) {
    editor.view.dispatch(tr);
  } else if (editor.dispatch) {
    editor.dispatch(tr);
  }

  return {
    success: true,
    operation: 'insert',
    beforeBlockId: resolvedId,
    newBlockId: newBlockId
  };
}

/**
 * Add a comment to a block.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @param {string} commentText - Comment content
 * @param {Author} [author] - Author info
 * @returns {Promise<OperationResult>}
 */
export async function addCommentToBlock(editor, blockId, commentText, author = DEFAULT_AUTHOR) {
  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }

  const blockInfo = getBlockInfo(editor, resolvedId);
  if (!blockInfo) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }

  const { node, pos } = blockInfo;
  // Build position map to find actual content boundaries
  const originalText = extractNodeText(node);
  const positionMap = buildPositionMap(editor, pos, originalText, node.nodeSize);
  const from = positionMap[0];
  const to = positionMap[originalText.length - 1] + 1;
  
  if (from === undefined || to === undefined) {
    return { success: false, error: 'Could not determine content boundaries' };
  }

  // Set selection
  editor.commands.setTextSelection({ from, to });

  const commentId = generateCommentId();

  // Apply comment mark using chain if available
  if (editor.chain) {
    editor.chain()
      .setMark('commentMark', {
        commentId: commentId,
        internal: false,
      })
      .run();
  } else if (editor.commands.setMark) {
    editor.commands.setMark('commentMark', {
      commentId: commentId,
      internal: false,
    });
  }

  return {
    success: true,
    operation: 'comment',
    blockId: resolvedId,
    commentId: commentId
  };
}

/**
 * Get block content by ID.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @returns {{ success: boolean, text?: string, node?: Node, pos?: number, error?: string }}
 */
export function getBlockById(editor, blockId) {
  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }

  const blockInfo = getBlockInfo(editor, resolvedId);
  if (!blockInfo) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }

  const { node, pos } = blockInfo;
  const text = extractNodeText(node);

  return {
    success: true,
    text,
    node,
    pos,
    blockId: resolvedId
  };
}
