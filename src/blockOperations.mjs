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
 * @returns {OperationResult}
 */
function applyWordDiff(editor, pos, node, originalText, newText, author, comment) {
  const operations = diffToOperations(originalText, newText);

  let stats = { insertions: 0, deletions: 0, unchanged: 0 };

  // SuperDoc uses paragraph > run > text structure, so content is at pos + 2
  // (pos + 1 would be the run node opening, pos + 2 is the actual text)
  const contentStart = pos + 2;

  // CRITICAL: Sort operations by position in DESCENDING order (end-to-start)
  // This ensures earlier positions remain valid as we modify from the end
  const sortedOps = [...operations].sort((a, b) => b.position - a.position);

  for (const op of sortedOps) {
    // Apply each operation atomically - the operation completes fully
    // before we move to the next one. Since we're going end-to-start,
    // the position for this operation is still valid.
    
    let success = true;
    
    if (op.type === 'delete') {
      const from = contentStart + op.position;
      const to = from + op.text.length;

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
      const insertAt = contentStart + op.position;

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
      const from = contentStart + op.position;
      const to = from + op.deleteText.length;

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
      return {
        success: false,
        error: `Word diff operation failed at position ${op.position}`,
        blockId: node.attrs.sdBlockId
      };
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
  // SuperDoc uses paragraph > run > text structure
  // Content text starts at pos + 2, ends at pos + nodeSize - 2
  const from = pos + 2;
  const to = pos + node.nodeSize - 2;

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
 * @returns {Promise<OperationResult>}
 */
export async function replaceBlockById(editor, blockId, newText, options = {}) {
  const {
    diff = true,
    trackChanges = true,
    comment = null,
    author = DEFAULT_AUTHOR
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
      const diffResult = applyWordDiff(editor, pos, node, originalText, newText, author, comment);
      
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
  // SuperDoc uses paragraph > run > text structure
  // Content text starts at pos + 2, ends at pos + nodeSize - 2
  const from = pos + 2;
  const to = pos + node.nodeSize - 2;

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
