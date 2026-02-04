# Phase 3: Validation & Edit Ordering

> **Priority**: High  
> **Dependencies**: Phases 1, 2  
> **Deliverables**: `editApplicator.mjs`

[← Back to Index](./index.md) | [← Phase 2](./phase-2-block-operations.md)

---

## Objectives

1. Implement edit validation against document IR
2. Build the edit application orchestrator
3. Implement reverse document order sorting for safe edit application
4. Handle the atomic apply workflow (load once, apply all, export once)

---

## Module: Edit Applicator (`src/editApplicator.mjs`)

### Purpose

The core module that validates and applies all edits to a document. This is the function that orchestrates the actual document modification, handling position resolution, sorting, and atomic application.

### Dependencies

```javascript
import { readFile, writeFile } from 'fs/promises';
import { createHeadlessEditor } from './editorFactory.mjs';
import { extractDocumentIR } from './irExtractor.mjs';
import { replaceBlockById, deleteBlockById, insertAfterBlock, addCommentToBlock } from './blockOperations.mjs';
import { sortEditsForApplication } from './editMerge.mjs';
```

---

## Core Functions

### `applyEdits`

```javascript
/**
 * Apply all edits to a document and export the result.
 * This is the CORE function that performs the actual document modification.
 * 
 * @param {string} inputPath - Path to input DOCX file
 * @param {string} outputPath - Path to output DOCX file
 * @param {EditConfig} editConfig - Edit configuration with edits array
 * @param {ApplyOptions} options - Application options
 * @returns {Promise<ApplyResult>}
 * 
 * @typedef {Object} ApplyOptions
 * @property {boolean} trackChanges - Enable track changes mode (default: true)
 * @property {Author} author - Author info for tracked changes
 * @property {boolean} validateFirst - Run validation before applying (default: true)
 * @property {boolean} sortEdits - Auto-sort edits for safe application (default: true)
 */
export async function applyEdits(inputPath, outputPath, editConfig, options = {}) {
  const {
    trackChanges = true,
    author = { name: 'AI Assistant', email: 'ai@example.com' },
    validateFirst = true,
    sortEdits = true
  } = options;
  
  const results = {
    success: true,
    applied: 0,
    skipped: [],
    details: [],
    comments: []
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
  if (validateFirst) {
    const validation = validateEditsAgainstIR(editConfig.edits, ir);
    if (!validation.valid) {
      // Add validation failures to skipped
      for (const issue of validation.issues) {
        results.skipped.push({
          index: issue.editIndex,
          blockId: issue.blockId,
          reason: issue.message
        });
      }
      // Filter out invalid edits
      editConfig.edits = editConfig.edits.filter((_, i) => 
        !validation.issues.some(issue => issue.editIndex === i)
      );
    }
  }
  
  // Step 4: Sort edits for safe application (descending by position)
  let editsToApply = editConfig.edits;
  if (sortEdits) {
    editsToApply = sortEditsForApplication(editConfig.edits, ir);
  }
  
  // Step 5: Apply each edit
  for (let i = 0; i < editsToApply.length; i++) {
    const edit = editsToApply[i];
    const editResult = await applyOneEdit(editor, edit, author, results.comments);
    
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
```

### `applyOneEdit`

```javascript
/**
 * Apply a single edit operation.
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @param {Edit} edit - Edit to apply
 * @param {Author} author - Author info
 * @param {Array} commentsStore - Array to collect comments
 * @returns {Promise<{success: boolean, error?: string, details?: object}>}
 */
async function applyOneEdit(editor, edit, author, commentsStore) {
  const { operation, blockId, afterBlockId } = edit;
  
  try {
    switch (operation) {
      case 'replace':
        const replaceResult = await replaceBlockById(editor, blockId, edit.newText, {
          diff: edit.diff !== false,  // Default to diff mode
          trackChanges: true,
          author
        });
        
        if (replaceResult.success && edit.comment) {
          await addCommentToBlock(editor, blockId, edit.comment, author);
        }
        
        return {
          success: replaceResult.success,
          error: replaceResult.error,
          details: { diffStats: replaceResult.diffStats }
        };
        
      case 'delete':
        const deleteResult = await deleteBlockById(editor, blockId, {
          trackChanges: true,
          author
        });
        
        // Note: Can't add comment to deleted block
        
        return {
          success: deleteResult.success,
          error: deleteResult.error
        };
        
      case 'comment':
        const commentResult = await addCommentToBlock(editor, blockId, edit.comment, author);
        return {
          success: commentResult.success,
          error: commentResult.error,
          details: { commentId: commentResult.commentId }
        };
        
      case 'insert':
        const insertResult = await insertAfterBlock(editor, afterBlockId, edit.text, {
          type: edit.type || 'paragraph',
          level: edit.level,
          trackChanges: true,
          author
        });
        
        if (insertResult.success && edit.comment) {
          await addCommentToBlock(editor, insertResult.newBlockId, edit.comment, author);
        }
        
        return {
          success: insertResult.success,
          error: insertResult.error,
          details: { newBlockId: insertResult.newBlockId }
        };
        
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
```

### `validateEdits`

```javascript
/**
 * Validate edits against a document without applying them.
 * 
 * @param {string} inputPath - Path to DOCX file
 * @param {EditConfig} editConfig - Edit configuration
 * @returns {Promise<ValidationResult>}
 */
export async function validateEdits(inputPath, editConfig) {
  const ir = await extractDocumentIR(inputPath);
  return validateEditsAgainstIR(editConfig.edits, ir);
}
```

### `validateEditsAgainstIR`

```javascript
/**
 * Validate edits against an already-extracted IR.
 * 
 * @param {Edit[]} edits - Array of edits
 * @param {DocumentIR} ir - Document IR
 * @returns {ValidationResult}
 */
function validateEditsAgainstIR(edits, ir) {
  const issues = [];
  const blockIdSet = new Set(ir.blocks.map(b => b.id));
  const seqIdSet = new Set(ir.blocks.map(b => b.seqId));
  
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
  }
  
  return {
    valid: issues.length === 0,
    issues,
    summary: {
      totalEdits: edits.length,
      validEdits: edits.length - issues.length,
      invalidEdits: issues.length
    }
  };
}
```

### `extractDocumentIRFromEditor`

```javascript
/**
 * Extract IR directly from an already-loaded editor.
 * Used internally to avoid reloading the document.
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @returns {DocumentIR}
 */
function extractDocumentIRFromEditor(editor) {
  // Similar to irExtractor but works with existing editor
  const blocks = [];
  const idMapping = {};
  
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.sdBlockId) {
      const seqId = node.attrs.seqId || `b${String(blocks.length + 1).padStart(3, '0')}`;
      blocks.push({
        id: node.attrs.sdBlockId,
        seqId: seqId,
        type: node.type.name,
        text: extractNodeText(node),
        startPos: pos,
        endPos: pos + node.nodeSize
      });
      idMapping[node.attrs.sdBlockId] = seqId;
    }
    return true;
  });
  
  return { blocks, idMapping };
}
```

### `sortEditsForApplication`

```javascript
/**
 * Sort edits for optimal application order.
 * Edits should be applied from end of document to start
 * to prevent position shifts from affecting later edits.
 * 
 * @param {Object[]} edits - Array of edit objects
 * @param {DocumentIR} ir - Document IR for position lookup
 * @returns {Object[]} - Sorted edits (descending by position)
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
    return posB - posA;  // Descending
  });
}
```

---

## The Critical Apply Algorithm

```
┌─────────────────────────────────────────────────────────────────────┐
│  applyEdits() - The Core Algorithm                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. LOAD: Read DOCX file, create headless editor                     │
│     └─► Single document load                                         │
│                                                                      │
│  2. EXTRACT IR: Get current positions for all blocks                 │
│     └─► Creates position lookup map                                  │
│                                                                      │
│  3. VALIDATE: Check all block IDs exist                              │
│     └─► Filter out invalid edits, add to skipped                     │
│                                                                      │
│  4. SORT: Order edits by position DESCENDING                         │
│     ┌────────────────────────────────────────────────────────────┐  │
│     │ WHY DESCENDING?                                             │  │
│     │                                                             │  │
│     │ If we edit position 200 first, then position 50:           │  │
│     │   - Edit @ 200: document changes, positions > 200 shift    │  │
│     │   - Edit @ 50: position 50 is UNAFFECTED by above shift    │  │
│     │                                                             │  │
│     │ If we edited position 50 first:                             │  │
│     │   - Edit @ 50: positions > 50 shift                        │  │
│     │   - Edit @ 200: original pos 200 is now WRONG!             │  │
│     └────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  5. APPLY: Execute each edit in sorted order                         │
│     ├─► replace: replaceBlockById() with word-level diff            │
│     ├─► delete:  deleteBlockById()                                  │
│     ├─► comment: addCommentToBlock()                                │
│     └─► insert:  insertAfterBlock()                                 │
│                                                                      │
│  6. EXPORT: Write modified document once                             │
│     └─► Single document export                                       │
│                                                                      │
│  7. CLEANUP: Destroy editor instance                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why Position Shifts Don't Matter

The key to our approach is **reverse document order application**:

```
Document: [Block A @ 0] [Block B @ 100] [Block C @ 200]

Edits collected:
  - Edit 1: Replace Block A (will add 50 chars)
  - Edit 2: Replace Block C (will add 30 chars)

At APPLY time:
  1. Look up current position of Block C → 200
  2. Look up current position of Block A → 0

Sort by position (descending):
  1. Block C @ 200
  2. Block A @ 0

Apply in order:
  1. Edit Block C @ 200 (adds 30 chars)
     → Document is now: [A @ 0] [B @ 100] [C @ 200-230]
     → Position 0 is UNAFFECTED
  
  2. Edit Block A @ 0 (adds 50 chars)
     → Document is now: [A @ 0-150] [B @ 150] [C @ 250-280]
     → We already edited C, so the shift doesn't matter!

✅ Both edits applied correctly!
```

---

## Output Types

```typescript
interface ApplyResult {
  success: boolean;           // True if ALL edits applied
  applied: number;            // Count of successfully applied edits
  skipped: SkippedEdit[];     // Edits that failed
  details: AppliedEditDetail[];
  comments: CommentData[];    // Comments added for export
}

interface SkippedEdit {
  index: number;
  blockId: string;
  operation?: string;
  reason: string;
}

interface AppliedEditDetail {
  index: number;
  blockId: string;
  operation: string;
  diffStats?: DiffStats;      // For replace operations
  newBlockId?: string;        // For insert operations
  commentId?: string;         // For comment operations
}

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    totalEdits: number;
    validEdits: number;
    invalidEdits: number;
  };
}

interface ValidationIssue {
  editIndex: number;
  type: 'missing_block' | 'missing_field' | 'invalid_operation';
  blockId: string;
  message: string;
}
```

---

## Data Structures

### Edit Configuration Format

**File**: `edits.json`

```json
{
  "version": "0.2.0",
  "author": {
    "name": "AI Counsel",
    "email": "ai@firm.com"
  },
  "edits": [
    {
      "blockId": "b025",
      "operation": "replace",
      "newText": "all plant, machinery, vehicles, equipment, and fixtures;",
      "comment": "Added fixtures per negotiation",
      "diff": true
    },
    {
      "blockId": "550e8400-e29b-41d4-a716-446655440000",
      "operation": "delete",
      "comment": "Removed TUPE clause - not applicable in Singapore"
    },
    {
      "blockId": "b087",
      "operation": "comment",
      "comment": "Review: Consider updating liability cap to market standard"
    },
    {
      "afterBlockId": "b100",
      "operation": "insert",
      "text": "2.5 Additional Conditions Precedent\n\nThe Vendor shall provide...",
      "type": "paragraph",
      "comment": "New clause per term sheet requirement"
    }
  ]
}
```

### Edit Operations Reference

| Operation | Required Fields | Optional Fields | Description |
|-----------|-----------------|-----------------|-------------|
| `replace` | `blockId`, `newText` | `diff`, `comment` | Replace block content |
| `delete` | `blockId` | `comment` | Delete block entirely |
| `comment` | `blockId`, `comment` | - | Add comment to block |
| `insert` | `afterBlockId`, `text` | `type`, `level`, `comment` | Insert new block |

### Validation Result Format

```json
{
  "valid": false,
  "documentInfo": {
    "filename": "contract.docx",
    "blockCount": 156,
    "version": "0.2.0"
  },
  "errors": [
    {
      "editIndex": 2,
      "blockId": "b999",
      "error": "Block ID not found in document"
    }
  ],
  "warnings": [
    {
      "editIndex": 0,
      "blockId": "b025",
      "warning": "Block text appears to have changed since IR extraction",
      "currentText": "all plant, machinery and equipment;",
      "expectedLength": 45
    }
  ],
  "summary": {
    "totalEdits": 4,
    "validEdits": 3,
    "invalidEdits": 1,
    "warningCount": 1
  }
}
```

---

## Test Requirements

### File: `tests/editApplicator.test.mjs`

```javascript
describe('validateEdits', () => {
  test('validates edits with valid block IDs', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const edits = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'test' }
      ]
    };
    
    const result = await validateEdits('fixtures/sample.docx', edits);
    expect(result.valid).toBe(true);
  });
  
  test('rejects edits with missing block IDs', async () => {
    const edits = {
      edits: [
        { blockId: 'b999', operation: 'replace', newText: 'test' }
      ]
    };
    
    const result = await validateEdits('fixtures/sample.docx', edits);
    expect(result.valid).toBe(false);
    expect(result.issues[0].type).toBe('missing_block');
  });
  
  test('rejects replace without newText', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const edits = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace' }
      ]
    };
    
    const result = await validateEdits('fixtures/sample.docx', edits);
    expect(result.valid).toBe(false);
    expect(result.issues[0].type).toBe('missing_field');
  });
});

describe('sortEditsForApplication', () => {
  test('sorts edits by position descending', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const edits = [
      { blockId: 'b001', operation: 'replace', newText: 'first' },
      { blockId: 'b050', operation: 'replace', newText: 'middle' },
      { blockId: 'b100', operation: 'replace', newText: 'last' }
    ];
    
    const sorted = sortEditsForApplication(edits, ir);
    
    // Highest position first
    expect(sorted[0].blockId).toBe('b100');
    expect(sorted[sorted.length - 1].blockId).toBe('b001');
  });
});

describe('applyEdits', () => {
  test('applies single edit', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'Modified' }
      ]
    };
    
    const result = await applyEdits(
      'fixtures/sample.docx',
      'output/single-edit-test.docx',
      editConfig
    );
    
    expect(result.success).toBe(true);
    expect(result.applied).toBe(1);
  });
  
  test('applies multiple edits in correct order', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'First' },
        { blockId: ir.blocks[5].seqId, operation: 'replace', newText: 'Fifth' }
      ]
    };
    
    const result = await applyEdits(
      'fixtures/sample.docx',
      'output/multi-edit-test.docx',
      editConfig
    );
    
    expect(result.success).toBe(true);
    expect(result.applied).toBe(2);
  });
  
  test('skips invalid edits but applies valid ones', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'Valid' },
        { blockId: 'b999', operation: 'replace', newText: 'Invalid' }
      ]
    };
    
    const result = await applyEdits(
      'fixtures/sample.docx',
      'output/partial-edit-test.docx',
      editConfig
    );
    
    expect(result.applied).toBe(1);
    expect(result.skipped.length).toBe(1);
  });
  
  test('exports valid DOCX file', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Test comment' }
      ]
    };
    
    await applyEdits(
      'fixtures/sample.docx',
      'output/export-test.docx',
      editConfig
    );
    
    // Verify file exists and is valid DOCX
    const { readFile } = await import('fs/promises');
    const buffer = await readFile('output/export-test.docx');
    expect(buffer.length).toBeGreaterThan(0);
    // DOCX files start with PK (ZIP signature)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });
});
```

---

## Success Criteria

1. **Validation works correctly**
   - Detects missing block IDs
   - Detects missing required fields
   - Returns clear error messages

2. **Sorting works correctly**
   - Edits are sorted by position descending
   - Position lookup handles both UUID and seqId

3. **Apply orchestration works**
   - Loads document once
   - Applies edits in correct order
   - Exports document once
   - Handles partial failures gracefully

4. **Track changes are preserved**
   - Changes appear as tracked changes
   - Comments are attached correctly

---

## Exit Conditions

- [ ] `src/editApplicator.mjs` implemented with all functions
- [ ] `validateEdits` correctly validates edit configurations
- [ ] `sortEditsForApplication` sorts by position descending
- [ ] `applyEdits` orchestrates the full workflow
- [ ] All Phase 3 tests pass
- [ ] Can apply multiple edits to test document without corruption

---

[← Back to Index](./index.md) | [← Phase 2](./phase-2-block-operations.md) | [Next: Phase 4 →](./phase-4-chunking-reader.md)
