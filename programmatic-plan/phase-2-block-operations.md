# Phase 2: Block Operations

> **Priority**: High  
> **Dependencies**: Phase 1 (Core Infrastructure)  
> **Deliverables**: `blockOperations.mjs`

[← Back to Index](./index.md) | [← Phase 1](./phase-1-core-infrastructure.md)

---

## Objectives

1. Implement ID-based document editing operations
2. Support word-level diff for minimal tracked changes
3. Handle both UUID and seqId block references
4. Integrate with SuperDoc's track changes system

---

## Module: Block Operations (`src/blockOperations.mjs`)

### Purpose

Provide ID-based document editing operations with track changes support.

### Dependencies

```javascript
import { computeWordDiff, diffToOperations } from './wordDiff.mjs';
```

---

## Core Functions

### `replaceBlockById`

```javascript
/**
 * Replace a block's content by its ID.
 * Supports word-level diff for minimal tracked changes.
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @param {string} newText - Replacement text
 * @param {ReplaceOptions} options
 * @returns {Promise<OperationResult>}
 * 
 * @typedef {Object} ReplaceOptions
 * @property {boolean} diff - Use word-level diff (default: true)
 * @property {boolean} trackChanges - Enable track changes (default: true)
 * @property {string} comment - Optional comment to attach
 * @property {Author} author - Author info for track changes
 */
export async function replaceBlockById(editor, blockId, newText, options = {}) {
  const {
    diff = true,
    trackChanges = true,
    comment = null,
    author = { name: 'AI Assistant', email: 'ai@example.com' }
  } = options;
  
  // Resolve blockId (could be UUID or seqId)
  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }
  
  // Enable track changes mode
  if (trackChanges) {
    editor.setDocumentMode?.('suggesting');
  }
  
  // Get current block content
  const blockInfo = editor.helpers.blockNode.getBlockNodeById(resolvedId);
  if (!blockInfo.length) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }
  
  const { node, pos } = blockInfo[0];
  const originalText = extractNodeText(node);
  
  if (diff) {
    // Apply word-level diff
    return applyWordDiff(editor, pos, node, originalText, newText, author, comment);
  } else {
    // Full replacement
    return applyFullReplace(editor, pos, node, newText, author, comment);
  }
}
```

### `deleteBlockById`

```javascript
/**
 * Delete a block by its ID.
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @param {DeleteOptions} options
 * @returns {Promise<OperationResult>}
 * 
 * @typedef {Object} DeleteOptions
 * @property {boolean} trackChanges - Enable track changes (default: true)
 * @property {string} comment - Optional comment explaining deletion
 * @property {Author} author - Author info
 */
export async function deleteBlockById(editor, blockId, options = {}) {
  const {
    trackChanges = true,
    comment = null,
    author = { name: 'AI Assistant', email: 'ai@example.com' }
  } = options;
  
  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }
  
  // Enable track changes mode
  if (trackChanges) {
    editor.setDocumentMode?.('suggesting');
  }
  
  // Use SuperDoc's native command
  const success = editor.commands.deleteBlockNodeById(resolvedId);
  
  return {
    success,
    operation: 'delete',
    blockId: resolvedId
  };
}
```

### `insertAfterBlock`

```javascript
/**
 * Insert a new block after an existing block.
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} afterBlockId - UUID or seqId of reference block
 * @param {string} text - Content for new block
 * @param {InsertOptions} options
 * @returns {Promise<OperationResult>}
 * 
 * @typedef {Object} InsertOptions
 * @property {'paragraph'|'heading'|'listItem'} type - Block type (default: 'paragraph')
 * @property {number} level - Heading level if type is 'heading'
 * @property {boolean} trackChanges - Enable track changes (default: true)
 * @property {string} comment - Optional comment
 * @property {Author} author - Author info
 */
export async function insertAfterBlock(editor, afterBlockId, text, options = {}) {
  const {
    type = 'paragraph',
    level = 1,
    trackChanges = true,
    comment = null,
    author = { name: 'AI Assistant', email: 'ai@example.com' }
  } = options;
  
  const resolvedId = resolveBlockId(editor, afterBlockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${afterBlockId}` };
  }
  
  // Enable track changes mode
  if (trackChanges) {
    editor.setDocumentMode?.('suggesting');
  }
  
  // Get target block position
  const blockInfo = editor.helpers.blockNode.getBlockNodeById(resolvedId);
  if (!blockInfo.length) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }
  
  const { node, pos } = blockInfo[0];
  const insertPos = pos + node.nodeSize;
  
  // Create new node
  const newNode = createNode(editor, type, text, { level });
  
  // Insert
  const tr = editor.state.tr.insert(insertPos, newNode);
  editor.view.dispatch(tr);
  
  return {
    success: true,
    operation: 'insert',
    afterBlockId: resolvedId,
    newBlockId: newNode.attrs.sdBlockId
  };
}
```

### `addCommentToBlock`

```javascript
/**
 * Add a comment to a block.
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} blockId - UUID or seqId of target block
 * @param {string} commentText - Comment content
 * @param {Author} author - Author info
 * @returns {Promise<OperationResult>}
 */
export async function addCommentToBlock(editor, blockId, commentText, author) {
  const resolvedId = resolveBlockId(editor, blockId);
  if (!resolvedId) {
    return { success: false, error: `Block not found: ${blockId}` };
  }
  
  const blockInfo = editor.helpers.blockNode.getBlockNodeById(resolvedId);
  if (!blockInfo.length) {
    return { success: false, error: `Block not found: ${resolvedId}` };
  }
  
  const { node, pos } = blockInfo[0];
  const from = pos + 1;  // Inside the block
  const to = pos + node.nodeSize - 1;
  
  // Set selection and apply comment mark
  editor.commands.setTextSelection({ from, to });
  
  const commentId = generateCommentId();
  editor.chain()
    .setMark('commentMark', {
      commentId: commentId,
      internal: false,
    })
    .run();
  
  return {
    success: true,
    operation: 'comment',
    blockId: resolvedId,
    commentId: commentId
  };
}
```

---

## Helper Functions

### `resolveBlockId`

```javascript
/**
 * Resolve a block ID (could be UUID or seqId) to a UUID.
 * 
 * @param {Editor} editor
 * @param {string} blockId - UUID or seqId
 * @returns {string|null} - Resolved UUID or null if not found
 */
function resolveBlockId(editor, blockId) {
  // If it looks like a seqId (e.g., "b001"), look up the UUID
  if (/^b\d+$/i.test(blockId)) {
    // Search for block with matching seqId attribute
    let foundId = null;
    editor.state.doc.descendants((node) => {
      if (node.attrs.seqId === blockId) {
        foundId = node.attrs.sdBlockId;
        return false;
      }
      return true;
    });
    return foundId;
  }
  
  // Assume it's already a UUID
  return blockId;
}
```

### `applyWordDiff`

```javascript
/**
 * Apply word-level diff to produce minimal tracked changes.
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
  const diffs = computeWordDiff(originalText, newText);
  const operations = diffToOperations(originalText, newText);
  
  let currentPos = pos + 1;  // Inside the block
  let stats = { insertions: 0, deletions: 0, unchanged: 0 };
  
  // Apply operations in order
  for (const op of operations) {
    if (op.type === 'equal') {
      currentPos += op.text.length;
      stats.unchanged++;
    } else if (op.type === 'delete') {
      // Select and delete
      editor.commands.setTextSelection({ 
        from: currentPos, 
        to: currentPos + op.text.length 
      });
      editor.commands.deleteSelection();
      stats.deletions++;
    } else if (op.type === 'insert') {
      // Insert at current position
      editor.commands.setTextSelection({ from: currentPos, to: currentPos });
      editor.commands.insertContent(op.text);
      currentPos += op.text.length;
      stats.insertions++;
    }
  }
  
  return {
    success: true,
    operation: 'replace',
    blockId: node.attrs.sdBlockId,
    diffStats: stats
  };
}
```

### `applyFullReplace`

```javascript
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
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  
  // Select all content and replace
  editor.commands.setTextSelection({ from, to });
  editor.commands.insertContent(newText);
  
  return {
    success: true,
    operation: 'replace',
    blockId: node.attrs.sdBlockId
  };
}
```

### `createNode`

```javascript
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
  const nodeType = schema.nodes[type === 'heading' ? 'heading' : 'paragraph'];
  
  const attrs = {
    sdBlockId: crypto.randomUUID()
  };
  
  if (type === 'heading' && options.level) {
    attrs.level = options.level;
  }
  
  return nodeType.create(attrs, schema.text(text));
}
```

### `generateCommentId`

```javascript
/**
 * Generate a unique comment ID.
 * @returns {string}
 */
function generateCommentId() {
  return 'comment-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}
```

### `extractNodeText`

```javascript
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
```

---

## Output Types

```typescript
interface OperationResult {
  success: boolean;
  operation?: 'replace' | 'delete' | 'insert' | 'comment';
  blockId?: string;
  newBlockId?: string;      // For insert operations
  commentId?: string;       // For comment operations
  error?: string;
  diffStats?: {             // For replace with diff
    insertions: number;
    deletions: number;
    unchanged: number;
  };
}

interface Author {
  name: string;
  email: string;
}
```

---

## Test Requirements

### File: `tests/blockOperations.test.mjs`

```javascript
describe('replaceBlockById', () => {
  test('replaces block content with UUID', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    const ir = await extractDocumentIR('fixtures/sample.docx');
    
    const result = await replaceBlockById(editor, ir.blocks[0].id, 'New text');
    expect(result.success).toBe(true);
    
    cleanup();
  });
  
  test('replaces block content with seqId', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await replaceBlockById(editor, 'b001', 'New text');
    expect(result.success).toBe(true);
    
    cleanup();
  });
  
  test('applies word-level diff when diff=true', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await replaceBlockById(editor, 'b001', 'Slightly modified text', { diff: true });
    expect(result.success).toBe(true);
    expect(result.diffStats).toBeDefined();
    
    cleanup();
  });
  
  test('returns error for non-existent block', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await replaceBlockById(editor, 'nonexistent', 'New text');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    
    cleanup();
  });
});

describe('deleteBlockById', () => {
  test('deletes block by UUID', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    const ir = await extractDocumentIR('fixtures/sample.docx');
    
    const result = await deleteBlockById(editor, ir.blocks[0].id);
    expect(result.success).toBe(true);
    
    cleanup();
  });
  
  test('deletes block by seqId', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await deleteBlockById(editor, 'b001');
    expect(result.success).toBe(true);
    
    cleanup();
  });
});

describe('insertAfterBlock', () => {
  test('inserts paragraph after block', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await insertAfterBlock(editor, 'b001', 'New paragraph text');
    expect(result.success).toBe(true);
    expect(result.newBlockId).toBeDefined();
    
    cleanup();
  });
  
  test('inserts heading with level', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await insertAfterBlock(editor, 'b001', 'New Heading', { 
      type: 'heading', 
      level: 2 
    });
    expect(result.success).toBe(true);
    
    cleanup();
  });
});

describe('addCommentToBlock', () => {
  test('adds comment to block', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    
    const result = await addCommentToBlock(
      editor, 
      'b001', 
      'This needs review', 
      { name: 'Test', email: 'test@test.com' }
    );
    expect(result.success).toBe(true);
    expect(result.commentId).toBeDefined();
    
    cleanup();
  });
});

describe('resolveBlockId', () => {
  test('resolves seqId to UUID', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    // First assign IDs via extraction
    await extractDocumentIR('fixtures/sample.docx');
    
    // resolveBlockId is internal, test via replaceBlockById
    const result = await replaceBlockById(editor, 'b001', 'test');
    expect(result.success).toBe(true);
    
    cleanup();
  });
  
  test('passes through UUID unchanged', async () => {
    const { editor, cleanup } = await setupEditor('fixtures/sample.docx');
    const ir = await extractDocumentIR('fixtures/sample.docx');
    
    const result = await replaceBlockById(editor, ir.blocks[0].id, 'test');
    expect(result.success).toBe(true);
    
    cleanup();
  });
});
```

---

## Success Criteria

1. **All operations work with UUID**
   - Replace, delete, insert, comment work with SuperDoc's native IDs

2. **All operations work with seqId**
   - `b001` style IDs correctly resolve to UUIDs

3. **Word-level diff produces minimal changes**
   - Only changed words show as tracked changes
   - Unchanged content is preserved

4. **Track changes mode is respected**
   - Changes appear as suggestions when enabled
   - Direct edits when disabled

5. **Error handling is robust**
   - Non-existent blocks return clear error messages
   - Operations don't throw exceptions

---

## Exit Conditions

- [ ] `src/blockOperations.mjs` implemented with all four operations
- [ ] `resolveBlockId` correctly handles both UUID and seqId
- [ ] Word-level diff integration works with existing `wordDiff.mjs`
- [ ] All Phase 2 tests pass
- [ ] Can perform replace, delete, insert, comment on test document

---

[← Back to Index](./index.md) | [← Phase 1](./phase-1-core-infrastructure.md) | [Next: Phase 3 →](./phase-3-validation-ordering.md)
