# Implementation Documentation

This document captures implementation decisions, API references, and usage examples for each phase.

---

## Phase 2: Block Operations

**Build ID**: `phase2-block-operations-20260204-b7c1`
**Status**: Complete
**Files**: `src/blockOperations.mjs`, `tests/blockOperations.test.mjs`

---

### Key Decisions

#### Decision 1: UUID Consistency Problem

**Problem Discovered**: SuperDoc generates fresh UUIDs (`sdBlockId`) every time a document is loaded. This means:

```javascript
// Load 1
const editor1 = await createEditorFromFile('contract.docx');
// Block has sdBlockId = "fac19829-aad7-4ac7-8058-a274ca190b73"

// Load 2
const editor2 = await createEditorFromFile('contract.docx');
// Same block now has sdBlockId = "56b77f35-7e78-4bb3-83a7-0022f40415a7"
```

The original test approach failed because:
1. `extractDocumentIR()` creates an editor, extracts IDs, then destroys the editor
2. Tests then created a new editor with different UUIDs
3. Block operations couldn't find the IDs from step 1

**Options Considered**:

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Return editor from IR extraction | IDs guaranteed consistent, matches real workflow | Caller must manage editor lifecycle |
| **B** | Look up blocks by position instead of ID | Works across editor instances | Defeats purpose of ID-based system, positions can shift |

**Decision**: **Option A** - Share the same editor instance between IR extraction and block operations.

**Rationale**:
- IDs are the core value proposition of this system
- Position-based lookups would reintroduce the fragility we're trying to eliminate
- The real workflow always involves: extract IR → make edits → export (single session)

**Implementation**: Added `createEditorWithIR()` function that returns both the IR and the editor instance.

---

#### Decision 2: Block Lookup Strategy

**Problem**: Need to find blocks by both UUID and seqId formats.

**Decision**: Implemented `resolveBlockId()` that:
1. Detects seqId format via regex (`/^b\d+$/i`)
2. For seqId: traverses document to find matching `seqId` attribute, returns UUID
3. For UUID: verifies it exists in document, returns as-is
4. Returns `null` if not found (never throws)

**Rationale**: Clean separation - all internal operations use UUID, but the public API accepts either format for convenience.

---

#### Decision 3: Error Handling Pattern

**Decision**: All operations return structured `OperationResult` objects instead of throwing exceptions.

```javascript
// Success
{ success: true, operation: 'replace', blockId: '...', diffStats: {...} }

// Failure
{ success: false, error: 'Block not found: b999' }
```

**Rationale**:
- Matches the spec requirement: "never throw exceptions from the main API"
- Easier for LLMs to handle - check `result.success` rather than try/catch
- Consistent with how the CLI will report results

---

#### Decision 4: Word-Level Diff Integration

**Decision**: Use existing `wordDiff.mjs` module via `diffToOperations()` which returns structured operations:

```javascript
{ type: 'delete', position: 10, text: 'old word' }
{ type: 'insert', position: 10, text: 'new word' }
{ type: 'replace', position: 10, deleteText: 'old', insertText: 'new' }
```

**Rationale**: The `diffToOperations()` function already merges adjacent delete+insert into replace operations, which maps cleanly to editor commands.

---

### API Reference

#### `createEditorWithIR(inputPath, options?)`

**Location**: `src/irExtractor.mjs`

Creates an editor and extracts IR in one call, ensuring ID consistency.

```javascript
import { createEditorWithIR } from './src/irExtractor.mjs';

const { editor, ir, cleanup } = await createEditorWithIR('contract.docx');

// ir.blocks[0].id is guaranteed to exist in editor
console.log(ir.blocks.length);  // e.g., 150 blocks

// ... perform operations on editor ...

cleanup();  // Destroys editor when done
```

**Parameters**:
- `inputPath` (string): Path to DOCX file
- `options` (object, optional): Same options as `extractDocumentIR()`

**Returns**: `{ ir: DocumentIR, editor: Editor, cleanup: Function }`

---

#### `extractIRFromEditor(editor, filename?, options?)`

**Location**: `src/irExtractor.mjs`

Extracts IR from an existing editor instance without destroying it.

```javascript
import { createEditorFromFile } from './src/editorFactory.mjs';
import { extractIRFromEditor } from './src/irExtractor.mjs';

const editor = await createEditorFromFile('contract.docx');
const ir = extractIRFromEditor(editor, 'contract.docx');

// Editor is still open, ir.blocks use editor's actual IDs
// ... use both editor and ir ...

editor.destroy();  // Manual cleanup
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `filename` (string, optional): Filename for metadata (default: 'document.docx')
- `options` (object, optional): Extraction options

**Returns**: `DocumentIR`

---

#### `replaceBlockById(editor, blockId, newText, options?)`

**Location**: `src/blockOperations.mjs`

Replaces a block's content. Supports word-level diff for minimal tracked changes.

```javascript
import { replaceBlockById } from './src/blockOperations.mjs';

// With word-level diff (default)
const result = await replaceBlockById(editor, 'b001', 'New clause text');
// result.diffStats = { insertions: 2, deletions: 1, unchanged: 0 }

// Full replacement (no diff)
const result = await replaceBlockById(editor, 'b001', 'New text', { diff: false });

// With UUID instead of seqId
const result = await replaceBlockById(editor, ir.blocks[0].id, 'New text');
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `blockId` (string): UUID or seqId (e.g., "b001")
- `newText` (string): Replacement text
- `options.diff` (boolean, default: true): Use word-level diff
- `options.trackChanges` (boolean, default: true): Enable track changes
- `options.comment` (string, optional): Comment to attach
- `options.author` (Author, optional): `{ name, email }`

**Returns**: `OperationResult`

---

#### `deleteBlockById(editor, blockId, options?)`

**Location**: `src/blockOperations.mjs`

Deletes a block by its ID.

```javascript
import { deleteBlockById } from './src/blockOperations.mjs';

const result = await deleteBlockById(editor, 'b005');
// result = { success: true, operation: 'delete', blockId: '...' }
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `blockId` (string): UUID or seqId
- `options.trackChanges` (boolean, default: true): Enable track changes
- `options.comment` (string, optional): Comment explaining deletion
- `options.author` (Author, optional): `{ name, email }`

**Returns**: `OperationResult`

---

#### `insertAfterBlock(editor, afterBlockId, text, options?)`

**Location**: `src/blockOperations.mjs`

Inserts a new block after an existing block.

```javascript
import { insertAfterBlock } from './src/blockOperations.mjs';

// Insert paragraph
const result = await insertAfterBlock(editor, 'b010', 'New paragraph text');
// result.newBlockId = UUID of the newly created block

// Insert heading
const result = await insertAfterBlock(editor, 'b010', 'New Section', {
  type: 'heading',
  level: 2
});
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `afterBlockId` (string): UUID or seqId of reference block
- `text` (string): Content for new block
- `options.type` ('paragraph' | 'heading' | 'listItem', default: 'paragraph')
- `options.level` (number, default: 1): Heading level if type is 'heading'
- `options.trackChanges` (boolean, default: true)
- `options.author` (Author, optional)

**Returns**: `OperationResult` with `newBlockId`

---

#### `insertBeforeBlock(editor, beforeBlockId, text, options?)`

**Location**: `src/blockOperations.mjs`

Inserts a new block before an existing block.

```javascript
import { insertBeforeBlock } from './src/blockOperations.mjs';

const result = await insertBeforeBlock(editor, 'b001', 'Preamble text');
```

**Parameters**: Same as `insertAfterBlock`, but inserts before the reference block.

**Returns**: `OperationResult` with `newBlockId`

---

#### `addCommentToBlock(editor, blockId, commentText, author?)`

**Location**: `src/blockOperations.mjs`

Adds a comment to an entire block.

```javascript
import { addCommentToBlock } from './src/blockOperations.mjs';

const result = await addCommentToBlock(
  editor,
  'b015',
  'This clause needs legal review',
  { name: 'AI Assistant', email: 'ai@example.com' }
);
// result.commentId = 'comment-1706789012345-a3f2b1c'
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `blockId` (string): UUID or seqId
- `commentText` (string): Comment content
- `author` (Author, optional): `{ name, email }` (default: AI Assistant)

**Returns**: `OperationResult` with `commentId`

---

#### `getBlockById(editor, blockId)`

**Location**: `src/blockOperations.mjs`

Retrieves block content and position by ID.

```javascript
import { getBlockById } from './src/blockOperations.mjs';

const result = getBlockById(editor, 'b001');
if (result.success) {
  console.log(result.text);  // Block's text content
  console.log(result.pos);   // Position in document
}
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `blockId` (string): UUID or seqId

**Returns**: `{ success, text?, pos?, node?, blockId?, error? }`

---

#### `resolveBlockId(editor, blockId)`

**Location**: `src/blockOperations.mjs`

Resolves a block ID (seqId or UUID) to a UUID.

```javascript
import { resolveBlockId } from './src/blockOperations.mjs';

const uuid = resolveBlockId(editor, 'b001');  // Returns UUID or null
const uuid2 = resolveBlockId(editor, 'abc-123-def');  // Returns same if valid
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `blockId` (string): UUID or seqId

**Returns**: `string | null`

---

### Type Definitions

```typescript
interface OperationResult {
  success: boolean;
  operation?: 'replace' | 'delete' | 'insert' | 'comment';
  blockId?: string;
  newBlockId?: string;      // For insert operations
  afterBlockId?: string;    // For insertAfter
  beforeBlockId?: string;   // For insertBefore
  commentId?: string;       // For comment operations
  error?: string;
  diffStats?: {
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

### Usage Example: Complete Workflow

```javascript
import { createEditorWithIR } from './src/irExtractor.mjs';
import {
  replaceBlockById,
  deleteBlockById,
  insertAfterBlock,
  addCommentToBlock
} from './src/blockOperations.mjs';

async function reviewContract(filePath) {
  // 1. Load document and extract IR
  const { editor, ir, cleanup } = await createEditorWithIR(filePath);

  console.log(`Loaded ${ir.blocks.length} blocks`);

  // 2. Find a clause to modify (e.g., by searching text)
  const targetBlock = ir.blocks.find(b => b.text.includes('indemnification'));

  if (targetBlock) {
    // 3. Replace with improved language
    await replaceBlockById(
      editor,
      targetBlock.id,
      'The Seller shall indemnify and hold harmless the Buyer...',
      { diff: true }  // Word-level diff for minimal changes
    );

    // 4. Add explanatory comment
    await addCommentToBlock(
      editor,
      targetBlock.id,
      'Strengthened indemnification language per client request'
    );
  }

  // 5. Insert a new clause after definitions
  const definitionsBlock = ir.blocks.find(b => b.text.includes('Definitions'));
  if (definitionsBlock) {
    await insertAfterBlock(
      editor,
      definitionsBlock.id,
      '"Material Adverse Change" means any change that...',
      { type: 'paragraph' }
    );
  }

  // 6. Export modified document
  const outputBuffer = await editor.exportDocx();

  // 7. Cleanup
  cleanup();

  return outputBuffer;
}
```

---

### Test Coverage

Phase 2 tests: **23 tests, all passing**

| Suite | Tests | Description |
|-------|-------|-------------|
| resolveBlockId | 3 | seqId resolution, UUID passthrough, not-found handling |
| getBlockById | 2 | Valid retrieval, error handling |
| replaceBlockById | 5 | UUID/seqId, diff modes, track changes, errors |
| deleteBlockById | 2 | Deletion, error handling |
| insertAfterBlock | 3 | Paragraph, heading, errors |
| insertBeforeBlock | 2 | Insertion, errors |
| addCommentToBlock | 2 | Comment creation, errors |
| integration | 2 | Multiple operations, large documents |
| error handling | 2 | Empty text, structured errors |

---

## Phase 3: Validation & Edit Applicator

**Build ID**: `phase3-edit-applicator-20260204-d9e2`
**Status**: Complete
**Files**: `src/editApplicator.mjs`, `tests/editApplicator.test.mjs`

---

### Key Decisions

#### Decision 1: SeqId Resolution for Cross-Session Edits

**Problem Discovered**: In the production workflow, the LLM generates edits.json referencing block IDs (seqIds like `b001`), but `applyEdits()` opens a fresh editor where UUIDs are different from the extraction session. The `resolveBlockId()` function in `blockOperations.mjs` couldn't find seqIds because they're not stored as node attributes - they're computed during IR extraction.

```javascript
// Workflow:
// 1. Extract IR -> edits.json uses seqId "b001"
// 2. Close editor
// 3. applyEdits opens NEW editor (different UUIDs)
// 4. "b001" lookup fails - seqId isn't a node attribute
```

**Options Considered**:

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Store seqId as node attribute during extraction | Would persist across sessions | Requires modifying document, complex |
| **B** | Resolve seqId to UUID using IR before calling block ops | Clean separation, IR-based | Requires IR available at apply time |
| **C** | Pass same editor from extraction to apply | IDs guaranteed consistent | Impractical for CLI workflow |

**Decision**: **Option B** - Resolve seqId to UUID using the IR extracted from the apply editor.

**Rationale**:
- The `applyEdits()` function already extracts IR from its editor for validation/sorting
- SeqIds are deterministically generated (b001, b002...) based on document traversal order
- The same document produces the same seqIds regardless of which editor loads it
- Clean separation: validation uses IR, block operations use UUIDs

**Implementation**: Added `resolveBlockIdFromIR()` helper that maps seqId/UUID to UUID before calling block operations:

```javascript
function resolveBlockIdFromIR(blockId, ir) {
  // First check if it's a seqId
  const bySeqId = ir.blocks.find(b => b.seqId === blockId);
  if (bySeqId) return bySeqId.id; // Return UUID

  // Check if it's already a UUID
  const byId = ir.blocks.find(b => b.id === blockId);
  if (byId) return byId.id;

  return null;
}
```

---

#### Decision 2: Edit Application Order Strategy

**Problem**: When multiple edits target different document positions, position-based shifts can corrupt subsequent edits if applied in wrong order.

**Decision**: Sort edits by document position **descending** (end-to-start) before applying.

**Rationale**:
```
Document: [Block A @ 0] [Block B @ 100] [Block C @ 200]

If we edit from start to end:
  1. Edit A @ 0 (adds 50 chars) → B shifts to 150, C shifts to 250
  2. Edit C @ 200 → WRONG! C is now at 250

If we edit from end to start:
  1. Edit C @ 200 → positions ≤200 unaffected
  2. Edit A @ 0 → C already edited, shift doesn't matter
```

**Implementation**:
```javascript
export function sortEditsForApplication(edits, ir) {
  const positionMap = new Map();
  for (const block of ir.blocks) {
    positionMap.set(block.id, block.startPos);
    positionMap.set(block.seqId, block.startPos);
  }

  return [...edits].sort((a, b) => {
    const posA = positionMap.get(a.blockId || a.afterBlockId) || 0;
    const posB = positionMap.get(b.blockId || b.afterBlockId) || 0;
    return posB - posA;  // Descending
  });
}
```

---

#### Decision 3: Validation Pipeline Architecture

**Problem**: Need to validate edits before applying, but also allow partial application when some edits are invalid.

**Decision**: Implement two-phase validation with graceful degradation:

1. **Pre-application validation**: Check all block IDs exist and required fields present
2. **Filter invalid edits**: Add to `skipped` array with reasons
3. **Apply remaining valid edits**: Continue even if some failed validation

**Rationale**:
- LLM-generated edits may have occasional errors (hallucinated block IDs)
- Better to apply 9 valid edits and report 1 failure than fail entirely
- `success: false` only when `skipped.length > 0` - caller can decide severity

**Implementation**:
```javascript
if (validateFirst) {
  const validation = validateEditsAgainstIR(editsToApply, ir);
  if (!validation.valid) {
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
```

---

#### Decision 4: Atomic Document Operations

**Problem**: Loading/exporting documents is expensive. Need efficient multi-edit workflow.

**Decision**: Single load, multiple operations, single export:

```
1. LOAD: Read DOCX file, create headless editor
   └─► Single document load

2. EXTRACT IR: Get positions for validation and sorting
   └─► Lightweight traversal

3. VALIDATE: Check all block IDs exist
   └─► Filter out invalid edits

4. SORT: Order edits by position descending
   └─► Prevents position shift corruption

5. APPLY: Execute each edit in sorted order
   ├─► replace: replaceBlockById()
   ├─► delete: deleteBlockById()
   ├─► comment: addCommentToBlock()
   └─► insert: insertAfterBlock()

6. EXPORT: Write modified document once
   └─► Single document export

7. CLEANUP: Destroy editor instance
```

**Rationale**:
- SuperDoc editor initialization is expensive (~15-20ms)
- Document export is expensive (~30-50ms for large docs)
- Batching all edits into single session is 10-100x faster than per-edit loading

---

#### Decision 5: Comment Storage for Export

**Problem**: Comments added during edit operations need to be exported with the document.

**Decision**: Collect comments in a `commentsStore` array passed through edit operations, then pass to `exportDocx()`.

**Implementation**:
```javascript
const results = { ..., comments: [] };

// In applyOneEdit:
if (replaceResult.success && edit.comment) {
  const commentResult = await addCommentToBlock(editor, blockId, edit.comment, author);
  if (commentResult.success) {
    commentsStore.push({
      id: commentResult.commentId,
      blockId: blockId,
      text: edit.comment,
      author: author
    });
  }
}

// At export:
const exportOptions = {
  commentsType: 'external',
  comments: results.comments  // Pass collected comments
};
```

---

### API Reference

#### `applyEdits(inputPath, outputPath, editConfig, options?)`

**Location**: `src/editApplicator.mjs`

The core function that orchestrates edit validation and application.

```javascript
import { applyEdits } from './src/editApplicator.mjs';

// Basic usage with seqIds
const result = await applyEdits(
  'contract.docx',
  'redlined.docx',
  {
    version: '0.2.0',
    author: { name: 'AI Counsel', email: 'ai@firm.com' },
    edits: [
      { blockId: 'b001', operation: 'replace', newText: 'Modified clause' },
      { blockId: 'b015', operation: 'comment', comment: 'Needs review' },
      { afterBlockId: 'b020', operation: 'insert', text: 'New paragraph' }
    ]
  }
);

if (result.success) {
  console.log(`Applied ${result.applied} edits`);
} else {
  console.log(`Applied ${result.applied}, skipped ${result.skipped.length}`);
  result.skipped.forEach(s => console.log(`  - ${s.blockId}: ${s.reason}`));
}
```

**Parameters**:
- `inputPath` (string): Path to input DOCX file
- `outputPath` (string): Path to output DOCX file
- `editConfig` (EditConfig): Edit configuration
  - `version` (string, optional): Config version
  - `author` (Author, optional): Author for track changes
  - `edits` (Edit[]): Array of edit operations
- `options` (ApplyOptions, optional):
  - `trackChanges` (boolean, default: true): Enable track changes mode
  - `author` (Author): Override author from editConfig
  - `validateFirst` (boolean, default: true): Validate before applying
  - `sortEdits` (boolean, default: true): Sort edits by position descending

**Returns**: `ApplyResult`

---

#### `validateEdits(inputPath, editConfig)`

**Location**: `src/editApplicator.mjs`

Validate edits against a document without applying them.

```javascript
import { validateEdits } from './src/editApplicator.mjs';

const result = await validateEdits('contract.docx', {
  edits: [
    { blockId: 'b001', operation: 'replace', newText: 'test' },
    { blockId: 'b999', operation: 'replace', newText: 'invalid' }
  ]
});

if (!result.valid) {
  console.log(`Found ${result.issues.length} validation issues:`);
  result.issues.forEach(issue => {
    console.log(`  Edit ${issue.editIndex}: ${issue.message}`);
  });
}
```

**Parameters**:
- `inputPath` (string): Path to DOCX file
- `editConfig` (EditConfig): Edit configuration to validate

**Returns**: `ValidationResult`

---

#### `validateEditsAgainstIR(edits, ir)`

**Location**: `src/editApplicator.mjs`

Validate edits against an already-extracted IR (lower-level function).

```javascript
import { validateEditsAgainstIR } from './src/editApplicator.mjs';

const ir = await extractDocumentIR('contract.docx');
const result = validateEditsAgainstIR(edits, ir);
```

**Parameters**:
- `edits` (Edit[]): Array of edits
- `ir` (DocumentIR): Document IR

**Returns**: `ValidationResult`

**Validation Checks**:
- Block ID exists (checks both UUID and seqId)
- Required fields present (`newText` for replace, `comment` for comment, `text` for insert)
- Operation is valid (`replace`, `delete`, `comment`, `insert`)

---

#### `sortEditsForApplication(edits, ir)`

**Location**: `src/editApplicator.mjs`

Sort edits by position descending for safe application.

```javascript
import { sortEditsForApplication } from './src/editApplicator.mjs';

const sortedEdits = sortEditsForApplication(edits, ir);
// Last document position first
```

**Parameters**:
- `edits` (Edit[]): Array of edits
- `ir` (DocumentIR): Document IR for position lookup

**Returns**: `Edit[]` - Sorted edits (does not mutate original)

---

#### `loadDocumentForEditing(inputPath, options?)`

**Location**: `src/editApplicator.mjs`

Load a document and return an editor with its IR. Useful for manual orchestration.

```javascript
import { loadDocumentForEditing } from './src/editApplicator.mjs';

const { editor, ir, cleanup } = await loadDocumentForEditing('contract.docx', {
  trackChanges: true,
  author: { name: 'Reviewer', email: 'review@firm.com' }
});

// Manual edit operations...
await replaceBlockById(editor, ir.blocks[0].id, 'Modified');

// Export when done
await exportDocument(editor, 'output.docx');
cleanup();
```

**Parameters**:
- `inputPath` (string): Path to DOCX file
- `options.trackChanges` (boolean, default: true): Enable track changes
- `options.author` (Author): Author info

**Returns**: `{ editor: Editor, ir: DocumentIR, cleanup: Function }`

---

#### `exportDocument(editor, outputPath, options?)`

**Location**: `src/editApplicator.mjs`

Export a modified document to file.

```javascript
import { exportDocument } from './src/editApplicator.mjs';

await exportDocument(editor, 'output.docx', {
  isFinalDoc: false,  // Keep track changes visible
  comments: collectedComments
});
```

**Parameters**:
- `editor` (Editor): SuperDoc editor instance
- `outputPath` (string): Output file path
- `options.isFinalDoc` (boolean, default: false): Accept all changes
- `options.comments` (Array, default: []): Comments to include

**Returns**: `Promise<void>`

---

### Type Definitions

```typescript
interface EditConfig {
  version?: string;
  author?: Author;
  edits: Edit[];
}

interface Edit {
  operation: 'replace' | 'delete' | 'comment' | 'insert';
  blockId?: string;      // For replace, delete, comment (seqId or UUID)
  afterBlockId?: string; // For insert (seqId or UUID)
  newText?: string;      // Required for replace
  text?: string;         // Required for insert
  comment?: string;      // Required for comment, optional for others
  diff?: boolean;        // For replace: use word-level diff (default: true)
  type?: 'paragraph' | 'heading' | 'listItem';  // For insert
  level?: number;        // Heading level for insert
}

interface ApplyOptions {
  trackChanges?: boolean;    // Default: true
  author?: Author;
  validateFirst?: boolean;   // Default: true
  sortEdits?: boolean;       // Default: true
}

interface ApplyResult {
  success: boolean;          // True if ALL edits applied
  applied: number;           // Count of successfully applied edits
  skipped: SkippedEdit[];    // Edits that failed
  details: AppliedEditDetail[];
  comments: CommentData[];   // Comments for export
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
  diffStats?: { insertions: number, deletions: number, unchanged: number };
  newBlockId?: string;    // For insert operations
  commentId?: string;     // For comment operations
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

### Usage Example: Complete CLI Workflow

```javascript
import { applyEdits } from './src/editApplicator.mjs';
import { readFile } from 'fs/promises';

// Read edits.json generated by LLM
const editsJson = JSON.parse(await readFile('edits.json', 'utf8'));

// Apply edits with track changes
const result = await applyEdits(
  'contract.docx',
  'redlined.docx',
  editsJson,
  { trackChanges: true }
);

// Report results
console.log(`\n✅ Applied ${result.applied} edits`);

if (result.skipped.length > 0) {
  console.log(`\n⚠️ Skipped ${result.skipped.length} edits:`);
  for (const skip of result.skipped) {
    console.log(`  - [${skip.operation}] ${skip.blockId}: ${skip.reason}`);
  }
}

console.log(`\n📄 Output: redlined.docx`);
```

### Usage Example: Programmatic Multi-Edit

```javascript
import { loadDocumentForEditing, exportDocument } from './src/editApplicator.mjs';
import { replaceBlockById, addCommentToBlock } from './src/blockOperations.mjs';

async function reviewContract(inputPath, outputPath) {
  const { editor, ir, cleanup } = await loadDocumentForEditing(inputPath);

  // Find indemnification clause
  const indemnityBlock = ir.blocks.find(b =>
    b.text.toLowerCase().includes('indemnification')
  );

  if (indemnityBlock) {
    // Strengthen the language
    await replaceBlockById(
      editor,
      indemnityBlock.id,
      indemnityBlock.text.replace(
        'shall indemnify',
        'shall fully indemnify, defend, and hold harmless'
      )
    );

    // Add explanatory comment
    await addCommentToBlock(
      editor,
      indemnityBlock.id,
      'Strengthened per client instructions'
    );
  }

  // Export and cleanup
  await exportDocument(editor, outputPath);
  cleanup();
}
```

---

### Test Coverage

Phase 3 tests: **23 tests, all passing**

| Suite | Tests | Description |
|-------|-------|-------------|
| validateEditsAgainstIR | 8 | Valid IDs, seqId format, missing blocks, missing fields, unknown ops |
| validateEdits | 1 | File-based validation |
| sortEditsForApplication | 3 | Position descending, seqId handling, insert operations |
| applyEdits | 10 | Replace, delete, comment, insert, multiple edits, partial failures, options |
| loadDocumentForEditing | 2 | ID consistency, trackChanges option |
| integration scenarios | 3 | Mixed operations, comments attached, v0.2.0 format |
| error handling | 3 | Non-existent file, empty edits, unknown operation |

---

## Phase 4: Chunking & Document Reader

**Build ID**: `phase4-chunking-reader-20260204-c8d1`
**Status**: Complete
**Files**: `src/chunking.mjs`, `src/documentReader.mjs`, `tests/chunking.test.mjs`, `tests/documentReader.test.mjs`

---

### Key Decisions

#### Decision 1: Token Estimation Strategy

**Problem**: Need to estimate token counts for chunking without access to actual tokenizer.

**Options Considered**:

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Character count / 4 | Simple, fast, no dependencies | Approximate, varies by content |
| **B** | Use tiktoken library | Accurate for GPT models | Extra dependency, model-specific |
| **C** | Word count based | Language-agnostic | Less accurate for mixed content |

**Decision**: **Option A** - Use character count / 4 as approximation.

**Rationale**:
- Industry standard approximation (4 chars ≈ 1 token for English)
- No external dependencies required
- Fast enough for real-time chunking decisions
- Good enough for chunking purposes (we err on the side of smaller chunks)

**Implementation**:
```javascript
const textTokens = Math.ceil((block.text?.length || 0) / 4);
const structureOverhead = 50;  // JSON metadata per block
```

---

#### Decision 2: Fixed Overhead Accounting

**Problem**: Each chunk has fixed overhead from outline + metadata that reduces available space for blocks.

**Decision**: Calculate fixed overhead once and subtract from available tokens:
- Outline tokens: ~20 tokens per outline item (title + structure)
- Metadata overhead: ~200 tokens (chunk metadata, idMapping structure)

**Implementation**:
```javascript
const outlineTokens = estimateOutlineTokens(ir.outline);
const metadataOverhead = 200;
const fixedOverhead = outlineTokens + metadataOverhead;
const availableForBlocks = maxTokens - fixedOverhead;
```

**Rationale**: This ensures each chunk stays within token limits even with the outline included.

---

#### Decision 3: Chunk Break Point Strategy

**Problem**: Where to split when a chunk exceeds token limit?

**Options Considered**:

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Break exactly at limit | Maximizes chunk size | May split mid-section |
| **B** | Look back for headings | Preserves document structure | May create uneven chunks |
| **C** | Look forward for headings | Also preserves structure | Wastes more space |

**Decision**: **Option B** - Look backwards up to 10 blocks for a heading to break before.

**Rationale**:
- Natural section boundaries improve LLM comprehension
- Lookback limit of 10 prevents excessively small chunks
- If no heading found, break at current position (graceful fallback)

**Implementation**:
```javascript
function findBreakPoint(blocks, searchStart, lookbackLimit = 10) {
  const minIndex = Math.max(0, searchStart - lookbackLimit);
  for (let i = searchStart; i >= minIndex; i--) {
    if (blocks[i].type === 'heading') {
      return i;  // Break before this heading
    }
  }
  return searchStart;  // No heading found, break here
}
```

---

#### Decision 4: Outline in Every Chunk

**Problem**: LLMs reading a middle chunk need document context.

**Decision**: Include the **full document outline** in every chunk.

**Rationale**:
- Enables LLMs to understand document structure regardless of which chunk they're reading
- Outline is relatively small compared to block content
- Critical for accurate clause references and navigation
- Matches the spec requirement explicitly

**Trade-off**: Slight token overhead per chunk, but essential for LLM comprehension.

---

#### Decision 5: Output Format Options

**Problem**: Different use cases need different levels of detail.

**Decision**: Support three output formats:

| Format | Use Case | Contents |
|--------|----------|----------|
| `full` | Editing, detailed analysis | All blocks, metadata, outline, idMapping |
| `outline` | Quick navigation, TOC | Metadata + outline only |
| `summary` | Overview, planning | Metadata, outline, blockCount, headings list |

**Additional Option**: `includeMetadata: false` strips IDs and positions from output to reduce tokens when editing isn't needed.

---

#### Decision 6: CLI Navigation Commands

**Problem**: LLMs need to know how to get the next chunk.

**Decision**: Include `nextChunkCommand` in results with the exact CLI command:

```javascript
nextChunkCommand: `node superdoc-redline.mjs read --input "${inputPath}" --chunk ${targetChunk + 1}`
```

**Rationale**:
- LLMs can execute the command directly
- No guessing about syntax
- Clear indication of pagination state via `hasMore` boolean

---

### API Reference

#### `estimateBlockTokens(block)`

**Location**: `src/chunking.mjs`

Estimates token count for a single block.

```javascript
import { estimateBlockTokens } from './src/chunking.mjs';

const block = { text: 'The Seller shall indemnify the Buyer...' };
const tokens = estimateBlockTokens(block);
// tokens = 50 (overhead) + Math.ceil(38 / 4) = 60
```

**Parameters**:
- `block` (Block): Document block with `text` property

**Returns**: `number` - Estimated token count

**Formula**: `ceil(text.length / 4) + 50` (50 = JSON structure overhead)

---

#### `estimateTokens(ir)`

**Location**: `src/chunking.mjs`

Estimates total tokens for a full document IR.

```javascript
import { estimateTokens } from './src/chunking.mjs';

const ir = await extractDocumentIR('contract.docx');
const totalTokens = estimateTokens(ir);
console.log(`Document has ~${totalTokens} tokens`);

if (totalTokens > 100000) {
  console.log('Document will need chunking');
}
```

**Parameters**:
- `ir` (DocumentIR): Full document intermediate representation

**Returns**: `number` - Estimated total token count

**Calculation**:
- Sum of all block tokens
- Plus ~20 tokens per outline item
- Plus ~200 tokens metadata overhead

---

#### `chunkDocument(ir, maxTokens?)`

**Location**: `src/chunking.mjs`

Splits a document IR into manageable chunks.

```javascript
import { chunkDocument } from './src/chunking.mjs';
import { extractDocumentIR } from './src/irExtractor.mjs';

const ir = await extractDocumentIR('large-contract.docx');
const chunks = chunkDocument(ir, 50000);  // 50k tokens per chunk

console.log(`Split into ${chunks.length} chunks`);

for (const chunk of chunks) {
  console.log(`Chunk ${chunk.metadata.chunkIndex}: blocks ${chunk.metadata.blockRange.start} - ${chunk.metadata.blockRange.end}`);
}
```

**Parameters**:
- `ir` (DocumentIR): Full document intermediate representation
- `maxTokens` (number, default: 100000): Maximum tokens per chunk

**Returns**: `ChunkedDocument[]` - Array of chunks, each containing:
- `metadata`: `{ filename, chunkIndex, totalChunks, blockRange: { start, end } }`
- `outline`: Full document outline (same in every chunk)
- `blocks`: Blocks in this chunk
- `idMapping`: `{ uuid -> seqId }` for blocks in this chunk

**Behavior**:
- Returns single chunk if document fits within `maxTokens`
- Prefers breaking at heading boundaries (looks back up to 10 blocks)
- All blocks are preserved across chunks (no data loss)
- `totalChunks` is set correctly in all chunks after processing

---

#### `readDocument(inputPath, options?)`

**Location**: `src/documentReader.mjs`

Main function for LLM document consumption with automatic chunking.

```javascript
import { readDocument } from './src/documentReader.mjs';

// Read entire small document
const result = await readDocument('contract.docx');
if (result.success) {
  console.log(`Read ${result.document.blocks.length} blocks`);
}

// Read specific chunk of large document
const chunk2 = await readDocument('large-contract.docx', {
  chunkIndex: 1,
  maxTokens: 50000
});

if (chunk2.hasMore) {
  console.log(`Next: ${chunk2.nextChunkCommand}`);
  // "node superdoc-redline.mjs read --input "large-contract.docx" --chunk 2"
}

// Get outline only (minimal tokens)
const outline = await readDocument('contract.docx', {
  format: 'outline'
});

// Get summary for planning
const summary = await readDocument('contract.docx', {
  format: 'summary',
  includeMetadata: false  // Strip IDs to save tokens
});
```

**Parameters**:
- `inputPath` (string): Path to DOCX file
- `options.chunkIndex` (number | null, default: null): Which chunk to read (0-indexed)
- `options.maxTokens` (number, default: 100000): Max tokens per chunk
- `options.format` ('full' | 'outline' | 'summary', default: 'full'): Output format
- `options.includeMetadata` (boolean, default: true): Include block IDs and positions

**Returns**: `ReadResult`
```typescript
{
  success: boolean;
  error?: string;
  totalChunks: number;
  currentChunk: number;
  hasMore: boolean;
  nextChunkCommand: string | null;
  document: ChunkedDocument | FormattedDocument;
}
```

---

#### `getDocumentStats(inputPath)`

**Location**: `src/documentReader.mjs`

Get quick document statistics for planning without full extraction.

```javascript
import { getDocumentStats } from './src/documentReader.mjs';

const stats = await getDocumentStats('large-contract.docx');

console.log(`File: ${stats.filename}`);
console.log(`Blocks: ${stats.blockCount}`);
console.log(`Estimated tokens: ${stats.estimatedTokens}`);
console.log(`Recommended chunks: ${stats.recommendedChunks}`);

// Plan chunking strategy
if (stats.recommendedChunks > 1) {
  console.log(`Document needs ${stats.recommendedChunks} chunks`);
}
```

**Parameters**:
- `inputPath` (string): Path to DOCX file

**Returns**: `DocumentStats`
```typescript
{
  filename: string;
  blockCount: number;
  estimatedCharacters: number;
  estimatedTokens: number;
  recommendedChunks: number;
}
```

**Note**: Uses truncated text extraction (100 chars/block) for speed.

---

### Type Definitions

```typescript
interface ChunkedDocument {
  metadata: {
    filename: string;
    chunkIndex: number;       // 0-indexed
    totalChunks: number;
    blockRange: {
      start: string;          // seqId of first block
      end: string;            // seqId of last block
    };
  };
  outline: OutlineItem[];     // Full document outline
  blocks: Block[];            // Blocks in this chunk
  idMapping: { [uuid: string]: string };
}

interface ReadResult {
  success: boolean;
  error?: string;
  totalChunks: number;
  currentChunk: number;
  hasMore: boolean;
  nextChunkCommand: string | null;
  document: ChunkedDocument | FormattedDocument | null;
}

interface DocumentStats {
  filename: string;
  blockCount: number;
  estimatedCharacters: number;
  estimatedTokens: number;
  recommendedChunks: number;
}

type OutputFormat = 'full' | 'outline' | 'summary';
```

---

### Usage Example: LLM Reading Workflow

```javascript
import { readDocument, getDocumentStats } from './src/documentReader.mjs';

async function readContractForLLM(filePath) {
  // 1. Check document size first
  const stats = await getDocumentStats(filePath);
  console.log(`Document: ${stats.blockCount} blocks, ~${stats.estimatedTokens} tokens`);

  // 2. If small enough, read entire document
  if (stats.recommendedChunks === 1) {
    const result = await readDocument(filePath, { format: 'full' });
    return result.document;
  }

  // 3. For large documents, read chunk by chunk
  const allBlocks = [];
  let currentChunk = 0;

  while (true) {
    const result = await readDocument(filePath, {
      chunkIndex: currentChunk,
      maxTokens: 50000  // Smaller chunks for LLM context
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    allBlocks.push(...result.document.blocks);
    console.log(`Read chunk ${currentChunk + 1}/${result.totalChunks}`);

    if (!result.hasMore) break;
    currentChunk++;
  }

  return allBlocks;
}
```

### Usage Example: Chunked Review with Agent

```javascript
import { readDocument } from './src/documentReader.mjs';

async function reviewInChunks(filePath) {
  // Get first chunk with outline for context
  const firstResult = await readDocument(filePath, {
    chunkIndex: 0,
    maxTokens: 80000,
    format: 'full'
  });

  // LLM can use outline to understand document structure
  const outline = firstResult.document.outline;
  console.log('Document sections:', outline.map(o => o.title));

  // Process each chunk
  for (let i = 0; i < firstResult.totalChunks; i++) {
    const result = await readDocument(filePath, {
      chunkIndex: i,
      maxTokens: 80000
    });

    // Each chunk has same outline for context
    console.log(`Processing chunk ${i + 1}: blocks ${result.document.metadata.blockRange.start} to ${result.document.metadata.blockRange.end}`);

    // LLM processes this chunk's blocks...
    // Generates edits referencing block IDs from this chunk
  }
}
```

---

### Test Coverage

Phase 4 tests: **39 tests, all passing**

| File | Tests | Description |
|------|-------|-------------|
| `chunking.test.mjs` | 23 | Token estimation, chunking algorithm, edge cases |
| `documentReader.test.mjs` | 16 | Reading, formatting, stats, error handling |

**Key Test Scenarios**:

| Suite | Tests | Description |
|-------|-------|-------------|
| estimateBlockTokens | 5 | Small/large blocks, empty/null text handling |
| estimateTokens | 5 | Total estimation, outline inclusion, edge cases |
| chunkDocument | 13 | Single chunk, multi-chunk, block preservation, heading breaks |
| readDocument | 12 | Formats, chunking, navigation, errors |
| getDocumentStats | 4 | Statistics, recommendations, errors |

---

## Phase 1: Core Infrastructure

*(Documentation to be added retroactively if needed)*

---

## Phase 5: Multi-Agent Merge

**Build ID**: `phase5-multi-agent-merge-20260204-d9e2`
**Status**: Complete
**Files**: `src/editMerge.mjs`, `tests/editMerge.test.mjs`, `tests/multiAgent.test.mjs`

---

### Key Decisions

#### Decision 1: In-Memory vs File-Based Merge

**Problem**: Sub-agents can produce edits as files (CLI workflow) or as objects (programmatic workflow).

**Decision**: Support both with separate functions:
- `mergeEditFiles()` - File-based, reads JSON files from disk
- `mergeEdits()` - In-memory, works with edit objects directly

**Rationale**:
- CLI workflow naturally produces files
- Programmatic workflow (testing, embedded agents) works with objects
- Same conflict resolution logic shared between both

---

#### Decision 2: Conflict Detection Granularity

**Problem**: What counts as a "conflict" between sub-agents?

**Decision**: Any two edits targeting the **same block ID** are considered a conflict, regardless of operation type.

**Rationale**:
- Simple, predictable behavior
- Avoids complex semantic analysis (e.g., "is comment + replace a conflict?")
- Let the orchestrator decide via conflict strategy
- Matches the spec's approach

**Example conflicts**:
```javascript
// Conflict: same blockId, any operation mix
{ blockId: 'b001', operation: 'replace', newText: 'A' }
{ blockId: 'b001', operation: 'comment', comment: 'B' }

// NOT a conflict: different blockIds
{ blockId: 'b001', operation: 'replace', newText: 'A' }
{ blockId: 'b002', operation: 'replace', newText: 'B' }
```

---

#### Decision 3: Conflict Resolution Strategies

**Problem**: How to resolve when multiple agents edit the same block?

**Decision**: Four strategies, selectable by the orchestrator:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `error` | Fail merge entirely | Strict workflows, catch mistakes |
| `first` | Keep first edit (by file order) | Priority-based agents |
| `last` | Keep last edit (by file order) | Override pattern |
| `combine` | Merge comments; use `first` for other ops | Comment aggregation |

**Rationale**:
- `error` is the safe default - forces explicit resolution
- File order determines priority for `first`/`last` - gives orchestrator control
- `combine` handles the common case of multiple agents adding comments

**Implementation for `combine`**:
```javascript
if (edit.operation === 'comment' && existing.operation === 'comment') {
  existing.comment = `${existing.comment}\n\n---\n\n${edit.comment}`;
  conflict.resolution = 'combined';
} else {
  // Non-comment operations fall back to 'first'
  conflict.resolution = 'first';
}
```

---

#### Decision 4: Delete-Then-Reference Detection

**Problem**: One agent deletes a block, another references it. This is a semantic conflict.

**Decision**: `validateMergedEdits()` detects and reports this as an error:

```javascript
// This is invalid - b001 is deleted, then referenced
{
  edits: [
    { blockId: 'b001', operation: 'delete' },
    { afterBlockId: 'b001', operation: 'insert', text: 'new' }  // ERROR
  ]
}
```

**Detection approach**:
1. Track all deleted block IDs as we iterate through edits
2. Check if any later edit references a deleted block via `blockId` or `afterBlockId`
3. Report as `delete_then_reference` issue

**Rationale**:
- Catches logical errors before apply phase
- Order matters - delete then reference is bad, but reference then delete is valid
- Works across sub-agent boundaries after merge

---

#### Decision 5: Block Range Splitting for Parallel Agents

**Problem**: How should an orchestrator divide work among sub-agents?

**Decision**: Provide `splitBlocksForAgents()` utility function:

```javascript
const ranges = splitBlocksForAgents(ir, 3);
// [
//   { agentIndex: 0, startSeqId: 'b001', endSeqId: 'b050', blockCount: 50 },
//   { agentIndex: 1, startSeqId: 'b051', endSeqId: 'b100', blockCount: 50 },
//   { agentIndex: 2, startSeqId: 'b101', endSeqId: 'b150', blockCount: 50 }
// ]
```

**Options for `respectHeadings`**:
- `true` (default): Try to break at heading boundaries
- `false`: Split evenly by block count

**Rationale**:
- Deterministic assignment prevents overlaps
- Heading-aware splits improve semantic coherence
- Orchestrator can still do custom assignment if needed

---

#### Decision 6: Merge Metadata Preservation

**Problem**: After merge, how do we know what happened?

**Decision**: Include `_mergeInfo` in the output:

```javascript
{
  version: '0.2.0',
  _mergeInfo: {
    sourceFiles: ['edits-a.json', 'edits-b.json'],
    mergedAt: '2026-02-04T11:00:00.000Z',
    conflictStrategy: 'first',
    conflictsResolved: 2
  },
  edits: [...]
}
```

**Rationale**:
- Audit trail for debugging
- Know which strategy was used
- Count of resolved conflicts for logging
- Underscore prefix indicates internal metadata

---

### API Reference

#### `mergeEditFiles(editFilePaths, options?)`

**Location**: `src/editMerge.mjs`

Merges multiple edit JSON files from sub-agents.

```javascript
import { mergeEditFiles } from './src/editMerge.mjs';

// Basic merge - fail on any conflict
const result = await mergeEditFiles([
  'edits-definitions.json',
  'edits-warranties.json',
  'edits-govlaw.json'
]);

if (!result.success) {
  console.log(`Merge failed: ${result.error}`);
  console.log(`Conflicts:`, result.conflicts);
}

// Merge with conflict resolution
const result = await mergeEditFiles(
  ['edits-a.json', 'edits-b.json'],
  {
    conflictStrategy: 'combine',  // Merge comments, first for others
    outputPath: 'merged-edits.json'
  }
);
```

**Parameters**:
- `editFilePaths` (string[]): Paths to edit JSON files
- `options.conflictStrategy` ('error' | 'first' | 'last' | 'combine', default: 'error')
- `options.preserveOrder` (boolean, default: true): Maintain edit order within files
- `options.outputPath` (string, optional): Write merged result to file

**Returns**: `MergeResult`

---

#### `mergeEdits(editFiles, options?)`

**Location**: `src/editMerge.mjs`

In-memory version for programmatic use.

```javascript
import { mergeEdits } from './src/editMerge.mjs';

const subAgentA = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'A' }] };
const subAgentB = { edits: [{ blockId: 'b002', operation: 'comment', comment: 'B' }] };

const result = mergeEdits([subAgentA, subAgentB], { conflictStrategy: 'first' });
```

**Parameters**: Same as `mergeEditFiles`, but takes edit objects instead of file paths.

**Returns**: `MergeResult`

---

#### `validateMergedEdits(mergedEdits, ir)`

**Location**: `src/editMerge.mjs`

Validates merged edits against document IR for semantic issues.

```javascript
import { validateMergedEdits } from './src/editMerge.mjs';

const validation = validateMergedEdits(mergeResult.merged, ir);

if (!validation.valid) {
  for (const issue of validation.issues) {
    console.log(`Edit ${issue.editIndex}: ${issue.type} - ${issue.message}`);
  }
}
```

**Parameters**:
- `mergedEdits` (MergedEditFile): Output from `mergeEditFiles` or `mergeEdits`
- `ir` (DocumentIR): Document intermediate representation

**Returns**: `MergeValidationResult`

**Validation Checks**:
- Missing block IDs (not in document)
- Delete-then-reference conflicts
- Reference to deleted blocks via `afterBlockId`

---

#### `sortEditsForApplication(edits, ir)`

**Location**: `src/editMerge.mjs`

Sorts edits by position descending for safe application.

```javascript
import { sortEditsForApplication } from './src/editMerge.mjs';

const sorted = sortEditsForApplication(mergeResult.merged.edits, ir);
// Last document position first - prevents position shift issues
```

**Parameters**:
- `edits` (Edit[]): Array of edits
- `ir` (DocumentIR): Document IR for position lookup

**Returns**: `Edit[]` - Sorted array (does not mutate original)

**Note**: This is also exported from `editApplicator.mjs` and used internally by `applyEdits()`.

---

#### `analyzeConflicts(editFilePaths)`

**Location**: `src/editMerge.mjs`

Analyze potential conflicts without merging.

```javascript
import { analyzeConflicts } from './src/editMerge.mjs';

const analysis = await analyzeConflicts([
  'edits-a.json',
  'edits-b.json',
  'edits-c.json'
]);

if (analysis.hasConflicts) {
  console.log(`Found ${analysis.conflicts.length} conflicts`);
  console.log('Edits per block:', analysis.editCountsByBlock);
}
```

**Parameters**:
- `editFilePaths` (string[]): Paths to edit files

**Returns**: `ConflictAnalysis`
```typescript
{
  hasConflicts: boolean;
  conflicts: Conflict[];
  editCountsByBlock: { [blockId: string]: number };
}
```

**Use Case**: Preview conflicts before attempting merge.

---

#### `createEmptyEditFile(options?)`

**Location**: `src/editMerge.mjs`

Creates a valid edit file structure for sub-agents.

```javascript
import { createEmptyEditFile } from './src/editMerge.mjs';

const template = createEmptyEditFile({
  agentId: 'definitions-reviewer',
  assignedRange: 'b001-b050'
});

// {
//   version: '0.2.0',
//   _agentInfo: {
//     agentId: 'definitions-reviewer',
//     assignedRange: 'b001-b050',
//     createdAt: '2026-02-04T11:00:00.000Z'
//   },
//   edits: []
// }
```

**Parameters**:
- `options.agentId` (string, optional): Identifier for the sub-agent
- `options.assignedRange` (string, optional): Block range assigned to this agent

**Returns**: Empty edit file structure

---

#### `splitBlocksForAgents(ir, numAgents, options?)`

**Location**: `src/editMerge.mjs`

Divides document blocks into ranges for parallel agent processing.

```javascript
import { splitBlocksForAgents } from './src/editMerge.mjs';

const ranges = splitBlocksForAgents(ir, 4);

for (const range of ranges) {
  console.log(`Agent ${range.agentIndex}: ${range.startSeqId} to ${range.endSeqId} (${range.blockCount} blocks)`);

  // Assign to sub-agent
  assignToAgent(range.agentIndex, {
    blocks: ir.blocks.filter(b =>
      b.seqId >= range.startSeqId && b.seqId <= range.endSeqId
    )
  });
}
```

**Parameters**:
- `ir` (DocumentIR): Document intermediate representation
- `numAgents` (number): Number of sub-agents to split work between
- `options.respectHeadings` (boolean, default: true): Try to split at heading boundaries

**Returns**: `BlockRange[]`
```typescript
{
  agentIndex: number;     // 0-indexed
  startSeqId: string;     // First block in range
  endSeqId: string;       // Last block in range
  blockCount: number;     // Total blocks in range
}[]
```

---

### Type Definitions

```typescript
type ConflictStrategy = 'error' | 'first' | 'last' | 'combine';

interface MergeOptions {
  conflictStrategy?: ConflictStrategy;
  preserveOrder?: boolean;
  outputPath?: string;
}

interface MergeResult {
  success: boolean;
  error?: string;
  merged: MergedEditFile | null;
  conflicts: Conflict[];
  stats: {
    totalEdits: number;
    sourceFiles: number;
    conflictsDetected: number;
  };
}

interface Conflict {
  blockId: string;
  edits: Edit[];
  resolution: 'first' | 'last' | 'combined' | null;
}

interface MergedEditFile {
  version: '0.2.0';
  _mergeInfo: {
    sourceFiles?: string[];
    mergedAt: string;
    conflictStrategy: string;
    conflictsResolved: number;
  };
  edits: Edit[];
}

interface MergeValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

interface ValidationIssue {
  editIndex: number;
  type: 'missing_block' | 'delete_then_reference';
  blockId: string;
  message: string;
}

interface BlockRange {
  agentIndex: number;
  startSeqId: string;
  endSeqId: string;
  blockCount: number;
}

interface ConflictAnalysis {
  hasConflicts: boolean;
  conflicts: Conflict[];
  editCountsByBlock: { [blockId: string]: number };
}
```

---

### Usage Example: Complete Multi-Agent Workflow

```javascript
import { extractDocumentIR } from './src/irExtractor.mjs';
import { applyEdits } from './src/editApplicator.mjs';
import {
  mergeEditFiles,
  validateMergedEdits,
  splitBlocksForAgents,
  createEmptyEditFile
} from './src/editMerge.mjs';
import { writeFile } from 'fs/promises';

async function multiAgentReview(inputPath, outputPath) {
  // 1. Extract IR for the document
  const ir = await extractDocumentIR(inputPath);
  console.log(`Document has ${ir.blocks.length} blocks`);

  // 2. Split work among specialized agents
  const ranges = splitBlocksForAgents(ir, 3);

  // 3. Assign each agent a block range (simulated here)
  const agentTasks = [
    { name: 'definitions-agent', range: ranges[0], focus: 'definitions' },
    { name: 'warranties-agent', range: ranges[1], focus: 'warranties' },
    { name: 'govlaw-agent', range: ranges[2], focus: 'governing law' }
  ];

  // 4. Each agent produces an edit file (simulated)
  for (const task of agentTasks) {
    const editFile = createEmptyEditFile({
      agentId: task.name,
      assignedRange: `${task.range.startSeqId}-${task.range.endSeqId}`
    });

    // Agent adds edits for its assigned blocks...
    // (In practice, this would be done by sub-agents)

    await writeFile(`edits-${task.name}.json`, JSON.stringify(editFile, null, 2));
  }

  // 5. Merge all agent outputs
  const mergeResult = await mergeEditFiles(
    agentTasks.map(t => `edits-${t.name}.json`),
    { conflictStrategy: 'combine' }
  );

  if (!mergeResult.success) {
    console.error('Merge failed:', mergeResult.error);
    return;
  }

  console.log(`Merged ${mergeResult.stats.totalEdits} edits, ${mergeResult.stats.conflictsDetected} conflicts resolved`);

  // 6. Validate merged edits
  const validation = validateMergedEdits(mergeResult.merged, ir);
  if (!validation.valid) {
    console.error('Validation failed:', validation.issues);
    return;
  }

  // 7. Apply merged edits to document
  const result = await applyEdits(inputPath, outputPath, mergeResult.merged, {
    author: { name: 'Multi-Agent Review', email: 'review@firm.com' }
  });

  console.log(`Applied ${result.applied} edits to ${outputPath}`);
}
```

### Usage Example: Handling Conflicts

```javascript
import { mergeEditFiles, analyzeConflicts } from './src/editMerge.mjs';

async function mergeWithConflictHandling(editFiles) {
  // Preview conflicts first
  const analysis = await analyzeConflicts(editFiles);

  if (analysis.hasConflicts) {
    console.log(`Found ${analysis.conflicts.length} potential conflicts`);

    // Show which blocks have multiple edits
    for (const [blockId, count] of Object.entries(analysis.editCountsByBlock)) {
      if (count > 1) {
        console.log(`  Block ${blockId}: ${count} edits`);
      }
    }

    // User decides on strategy
    const strategy = await promptUser('Choose conflict strategy: error/first/last/combine');

    const result = await mergeEditFiles(editFiles, { conflictStrategy: strategy });

    if (result.conflicts.length > 0) {
      console.log('Conflicts resolved:');
      for (const c of result.conflicts) {
        console.log(`  ${c.blockId}: ${c.resolution}`);
      }
    }

    return result;
  }

  // No conflicts - straightforward merge
  return mergeEditFiles(editFiles);
}
```

---

### Test Coverage

Phase 5 tests: **53 tests, all passing**

| File | Tests | Description |
|------|-------|-------------|
| `editMerge.test.mjs` | 34 | Merge functions, conflict strategies, validation |
| `multiAgent.test.mjs` | 19 | End-to-end workflow, edge cases |

**Key Test Scenarios**:

| Suite | Tests | Description |
|-------|-------|-------------|
| mergeEditFiles | 14 | File-based merge, conflicts, strategies, output, errors |
| mergeEdits | 2 | In-memory merge, conflict handling |
| validateMergedEdits | 6 | Block validation, delete-then-reference detection |
| sortEditsForApplication | 5 | Position sorting, mixed IDs, edge cases |
| analyzeConflicts | 3 | Conflict detection, non-overlapping edits |
| createEmptyEditFile | 2 | Template creation, agent metadata |
| splitBlocksForAgents | 7 | Block splitting, heading respect, edge cases |
| Multi-Agent Workflow | 14 | Full workflow, conflict handling, document output |
| Edge Cases | 4 | Empty files, single agent, many agents, multi-block edits |

---

## Phase 6: CLI Rewrite

**Build ID**: `phase6-cli-rewrite-20260204-f3a4`
**Status**: Complete
**Files**: `superdoc-redline.mjs`, `tests/cli.test.mjs`

---

### Key Decisions

#### Decision 1: Subcommand Architecture

**Problem**: The v1.x CLI used a flat option-based interface (`--config`, `--inline`), which was complex and didn't scale well for the new ID-based workflow.

**Decision**: Adopt a subcommand architecture with five commands:
- `extract` - Extract structured IR from DOCX
- `read` - Read document for LLM consumption
- `validate` - Validate edits before applying
- `apply` - Apply ID-based edits
- `merge` - Merge edit files from sub-agents

**Rationale**:
- Each command has a clear, focused purpose
- Options are scoped to their relevant command
- Matches common CLI conventions (git, npm, docker)
- Better discoverability via `--help` on each command

---

#### Decision 2: Breaking Change - Remove v1.x Options

**Problem**: The old text-based editing interface (`--inline`, find/replace edits) is incompatible with the new ID-based approach.

**Decision**: Clean break with v1.x - remove all deprecated options:

| Removed | Replacement |
|---------|-------------|
| `--config <file>` | `apply --edits <file>` |
| `--inline <json>` | Removed entirely |
| `--edits <json>` (inline) | `apply --edits <file>` |
| find/replace edits | ID-based `blockId` edits |

**Rationale**:
- Clean API for new users
- ID-based edits are fundamentally different
- No confusion about which approach to use
- Versioned at `0.2.0` to signal breaking change

**Migration Path**: Existing workflows must:
1. Extract IR to get block IDs
2. Rewrite edits to use `blockId` instead of `find`
3. Use `apply` command instead of root command

---

#### Decision 3: JSON Output for LLM Consumption

**Problem**: LLMs need structured data, but CLIs traditionally output human-readable text.

**Decision**: Commands output different formats based on context:
- `read` - JSON to stdout (for LLM parsing)
- `validate` - JSON to stdout (for programmatic checking)
- `extract`, `apply`, `merge` - Human-readable to stdout, JSON to file

**Rationale**:
- `read` is specifically for LLMs - JSON is native
- `validate` results need parsing for error handling
- `extract`/`apply`/`merge` are typically run manually, so human output is friendlier
- Files always contain proper JSON for processing

---

#### Decision 4: Consistent Error Handling

**Problem**: Different commands need different error reporting strategies.

**Decision**: All errors use:
1. `console.error()` for error messages (stderr)
2. `process.exit(1)` for non-zero exit code
3. Structured output for validation failures

**Exit Codes**:
- `0` - Success
- `1` - Any error (file not found, validation failure, merge conflict with `error` strategy)

**Rationale**:
- Standard Unix conventions
- Scripts can check exit code for success/failure
- Errors don't pollute stdout (important for `read` command)

---

#### Decision 5: Optional Flags with Sensible Defaults

**Problem**: Many options are rarely changed. Verbosity vs convenience.

**Decision**: Default settings favor the common case:

| Option | Default | Reasoning |
|--------|---------|-----------|
| Track changes | `true` | Main purpose of the tool |
| Validate before apply | `true` | Catch errors early |
| Sort edits | `true` | Required for correctness |
| Author name | `"AI Assistant"` | Common LLM use case |
| Conflict strategy | `"error"` | Safe default |
| Max tokens | `100000` | Reasonable for most models |

**Override Pattern**: Use `--no-*` flags:
- `--no-track-changes`
- `--no-validate`
- `--no-sort`

**Rationale**:
- Zero configuration for typical usage
- Explicit opt-out when needed
- Commander.js convention for negation

---

#### Decision 6: Chunk Navigation in Output

**Problem**: When a document is chunked, how does the LLM know how to get the next chunk?

**Decision**: Include `nextChunkCommand` in the read output:

```json
{
  "success": true,
  "totalChunks": 3,
  "currentChunk": 0,
  "hasMore": true,
  "nextChunkCommand": "node superdoc-redline.mjs read --input \"doc.docx\" --chunk 1",
  "document": { ... }
}
```

**Rationale**:
- LLM can execute the exact command
- No need to construct the command manually
- Includes the full path for clarity
- `hasMore` boolean for simple continuation logic

---

### CLI Reference

#### `superdoc-redline extract`

Extract structured intermediate representation from a DOCX file.

```bash
node superdoc-redline.mjs extract --input doc.docx --output ir.json
node superdoc-redline.mjs extract -i doc.docx -o ir.json --max-text 100
node superdoc-redline.mjs extract -i doc.docx --no-defined-terms
```

**Options**:
- `-i, --input <path>` (required) - Input DOCX file
- `-o, --output <path>` - Output JSON file (default: `<input>-ir.json`)
- `-f, --format <type>` - Output format: `full|outline|blocks` (default: `full`)
- `--no-defined-terms` - Exclude defined terms extraction
- `--max-text <length>` - Truncate block text to length

**Output**: Human-readable summary to stdout, full IR to file.

---

#### `superdoc-redline read`

Read document for LLM consumption with automatic chunking.

```bash
node superdoc-redline.mjs read --input doc.docx
node superdoc-redline.mjs read -i doc.docx --chunk 1 --max-tokens 50000
node superdoc-redline.mjs read -i doc.docx --stats-only
node superdoc-redline.mjs read -i doc.docx -f outline
node superdoc-redline.mjs read -i doc.docx --no-metadata
```

**Options**:
- `-i, --input <path>` (required) - Input DOCX file
- `-c, --chunk <index>` - Specific chunk index (0-indexed)
- `--max-tokens <count>` - Max tokens per chunk (default: 100000)
- `-f, --format <type>` - Output format: `full|outline|summary` (default: `full`)
- `--stats-only` - Only show document statistics
- `--no-metadata` - Exclude block IDs and positions from output

**Output**: JSON to stdout for LLM parsing.

---

#### `superdoc-redline validate`

Validate edit instructions against a document.

```bash
node superdoc-redline.mjs validate --input doc.docx --edits edits.json
```

**Options**:
- `-i, --input <path>` (required) - Input DOCX file
- `-e, --edits <path>` (required) - Edits JSON file

**Output**: JSON validation result to stdout.

**Exit Code**: `0` if valid, `1` if issues found.

---

#### `superdoc-redline apply`

Apply ID-based edits to a document.

```bash
node superdoc-redline.mjs apply --input doc.docx --output redlined.docx --edits edits.json
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --author-name "Reviewer"
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --no-track-changes
```

**Options**:
- `-i, --input <path>` (required) - Input DOCX file
- `-o, --output <path>` (required) - Output DOCX file
- `-e, --edits <path>` (required) - Edits JSON file
- `--author-name <name>` - Author name for track changes (default: `"AI Assistant"`)
- `--author-email <email>` - Author email (default: `"ai@example.com"`)
- `--no-track-changes` - Disable track changes mode
- `--no-validate` - Skip validation before applying
- `--no-sort` - Skip automatic edit sorting

**Output**: Human-readable summary to stdout, modified DOCX to output file.

**Exit Code**: `0` if all edits applied, `1` if any skipped.

---

#### `superdoc-redline merge`

Merge edit files from multiple sub-agents.

```bash
node superdoc-redline.mjs merge edits-a.json edits-b.json -o merged.json
node superdoc-redline.mjs merge *.json -o merged.json --conflict first
node superdoc-redline.mjs merge edits-*.json -o merged.json -v doc.docx
```

**Options**:
- `<files...>` (required) - Edit files to merge (positional arguments)
- `-o, --output <path>` (required) - Output merged edits file
- `-c, --conflict <strategy>` - Conflict strategy: `error|first|last|combine` (default: `error`)
- `-v, --validate <docx>` - Validate merged edits against document

**Output**: Human-readable summary to stdout, merged edits to output file.

**Exit Code**: `0` if merge successful, `1` if conflicts with `error` strategy or validation fails.

---

### Edit File Format (v0.2.0)

```json
{
  "version": "0.2.0",
  "author": {
    "name": "AI Counsel",
    "email": "ai@firm.com"
  },
  "edits": [
    {
      "blockId": "b001",
      "operation": "replace",
      "newText": "Modified clause text",
      "comment": "Optional comment",
      "diff": true
    },
    {
      "blockId": "b015",
      "operation": "delete",
      "comment": "Removing redundant clause"
    },
    {
      "blockId": "b020",
      "operation": "comment",
      "comment": "Needs legal review"
    },
    {
      "afterBlockId": "b025",
      "operation": "insert",
      "text": "New paragraph content",
      "type": "paragraph"
    }
  ]
}
```

**Edit Operations**:

| Operation | Required Fields | Optional Fields | Description |
|-----------|----------------|-----------------|-------------|
| `replace` | `blockId`, `newText` | `comment`, `diff` | Replace block content |
| `delete` | `blockId` | `comment` | Delete block entirely |
| `comment` | `blockId`, `comment` | - | Add comment to block |
| `insert` | `afterBlockId`, `text` | `type`, `level`, `comment` | Insert new block |

**Field Details**:
- `blockId` / `afterBlockId` - UUID or seqId (e.g., `"b001"`)
- `diff` - Use word-level diff for replace (default: `true`)
- `type` - Block type for insert: `paragraph|heading|listItem` (default: `paragraph`)
- `level` - Heading level for insert (default: `1`)

---

### Test Coverage

Phase 6 tests: **37 tests, all passing**

| Suite | Tests | Description |
|-------|-------|-------------|
| CLI: help and version | 6 | Version output, help for all commands |
| CLI: extract | 5 | IR extraction, output format, options |
| CLI: read | 6 | Document reading, formats, stats, metadata |
| CLI: validate | 4 | Valid/invalid edits, field validation, summary |
| CLI: apply | 4 | Edit application, author, skipped edits, multiple |
| CLI: merge | 7 | Non-conflicting, conflicts, strategies, validation |
| CLI: error handling | 5 | Missing files, invalid JSON, graceful failures |

---

### Usage Example: Complete LLM Workflow

```bash
# Step 1: Extract IR to understand document structure
node superdoc-redline.mjs extract -i contract.docx -o contract-ir.json

# Step 2: Read document for LLM consumption
node superdoc-redline.mjs read -i contract.docx > document.json

# Step 3: LLM generates edits.json based on document.json
# (This happens in your LLM agent)

# Step 4: Validate edits before applying
node superdoc-redline.mjs validate -i contract.docx -e edits.json
# Exit code 0 = valid

# Step 5: Apply edits with track changes
node superdoc-redline.mjs apply -i contract.docx -o redlined.docx -e edits.json

# Result: redlined.docx with tracked changes and comments
```

### Usage Example: Multi-Agent Review

```bash
# Step 1: Extract IR for all agents
node superdoc-redline.mjs extract -i apa.docx -o apa-ir.json

# Step 2: Sub-agents work in parallel on different sections
# Agent A -> edits-definitions.json
# Agent B -> edits-warranties.json
# Agent C -> edits-govlaw.json

# Step 3: Merge all sub-agent edits
node superdoc-redline.mjs merge \
  edits-definitions.json \
  edits-warranties.json \
  edits-govlaw.json \
  -o merged-edits.json \
  -c combine \
  -v apa.docx

# Step 4: Apply merged edits
node superdoc-redline.mjs apply \
  -i apa.docx \
  -o apa-redlined.docx \
  -e merged-edits.json \
  --author-name "AI Review Team"
```

---

## Phase 7: Documentation & Integration Tests

**Build ID**: `phase7-docs-integration-20260204-e5f3`
**Status**: Complete
**Files**: `README.md`, `SKILL.md`, `tests/integration.test.mjs`

---

### Overview

Phase 7 focused on documentation and testing. This was primarily a documentation phase rather than a coding phase, as specified in the original plan.

---

### Work Done

#### 1. README.md Complete Rewrite

Rewrote the entire README.md to document v0.2.0:

- **New CLI commands**: Documented all 5 subcommands (`extract`, `read`, `validate`, `apply`, `merge`) with options, examples, and expected output
- **Edit format specification**: Full documentation of the v0.2.0 edit JSON format including all operations and fields
- **IR format specification**: Documented the intermediate representation structure
- **Dual ID system**: Explained UUID vs seqId and why seqIds are recommended for LLM use
- **Chunking documentation**: How large documents are handled, token estimation, and chunk navigation
- **Multi-agent workflow**: Step-by-step guide for parallel sub-agent pattern
- **Breaking changes from v1.x**: Migration guide for users of the old text-based interface
- **Module API reference**: Programmatic usage of all core modules

#### 2. SKILL.md Update

Updated SKILL.md for LLM agent consumption:

- **Quick workflow**: 5-step process from extract to apply
- **Edit operations reference table**: Concise operation summary
- **ID format explanation**: When to use seqId vs UUID
- **Chunking instructions**: How to handle large documents
- **Multi-agent workflow**: Brief guide for parallel agents
- **CLI quick reference**: Command cheat sheet
- **Example**: Legal contract review with realistic edits

#### 3. Integration Tests

Created `tests/integration.test.mjs` with comprehensive end-to-end tests:

| Suite | Tests | Description |
|-------|-------|-------------|
| Full Workflow Integration | 3 | Extract → read → validate → apply round trip |
| Invalid Edit Handling | 3 | Missing block IDs, missing fields, unknown operations |
| Multi-Agent Workflow | 3 | Merge without conflicts, combine strategy, error strategy |
| Chunking Integration | 4 | Stats, boundaries, content preservation, outline inclusion |
| Error Handling | 3 | Non-existent files, empty edits |
| ID Format Compatibility | 2 | seqId stability, cross-session validation |

**Total integration tests**: 18 tests

---

### Key Decisions

#### Decision 1: Test Fixture Selection

**Problem**: The `sample.docx` fixture only contains 1 block, making multi-agent tests impossible (can't have 2 agents editing different blocks).

**Decision**: Multi-agent tests use `asset-purchase.docx` (1337 blocks) when available, with graceful skip if the fixture is missing or too small.

**Rationale**: Integration tests should exercise realistic scenarios. A single-block document is not representative of real contract workflows.

---

#### Decision 2: UUID Instability Acknowledgment in Tests

**Problem**: The existing DOC.md documents that UUIDs change on every document load (Decision 1 in Phase 2). Tests that capture a UUID from one extraction and validate it in another session will fail.

**Decision**: Integration tests for ID compatibility explicitly verify that:
1. seqIds are stable across document loads
2. UUIDs are NOT stable across loads (expected behavior)
3. seqId-based edits validate correctly across sessions

**Rationale**: Tests should reflect documented system behavior, not fight against it.

---

#### Decision 3: Unique Test File Naming

**Problem**: Node.js test runner executes tests in parallel. Tests that shared temporary file names (e.g., `edits-a.json`) caused race conditions where one test would read files written by another test.

**Decision**: Each multi-agent test uses uniquely-named files (e.g., `merge-noconflict-a.json`, `merge-combine-a.json`) and cleans them up after completion.

**Rationale**: Test isolation is critical for parallel test execution.

---

### Deviations from Original Plan

1. **No separate test for invalid DOCX files**: The original plan included testing with invalid DOCX content. This was simplified since SuperDoc already handles this internally and there's no additional value in testing the library's error handling.

2. **Test fixture already existed**: The plan mentioned copying `asset-purchase.docx` from the precedent library - it was already present in `tests/fixtures/`.

3. **Simplified test counts**: The original plan suggested detailed test breakdowns by module. Instead, integration tests focus on full workflows since unit tests already cover individual module functions comprehensively.

---

### Final Test Results

```
# tests 345
# suites 92
# pass 345
# fail 0
```

All 345 tests pass including:
- 327 existing tests from Phases 1-6
- 18 new integration tests from Phase 7

---

### Exit Conditions Met

- [x] `README.md` completely rewritten
- [x] `SKILL.md` updated for v0.2.0
- [x] `tests/integration.test.mjs` implemented
- [x] All integration tests pass
- [x] `npm test` runs all tests successfully
- [x] Test fixtures present (`sample.docx`, `asset-purchase.docx`)

---

## Implementation Complete

All 7 phases have been implemented:

| Phase | Name | Status |
|-------|------|--------|
| **1** | Core Infrastructure | Complete |
| **2** | Block Operations | Complete |
| **3** | Validation & Ordering | Complete |
| **4** | Chunking & Reader | Complete |
| **5** | Multi-Agent Merge | Complete |
| **6** | CLI Rewrite | Complete |
| **7** | Docs & Integration | Complete |

The superdoc-redlines v0.2.0 system is now fully implemented with:
- ID-based editing for deterministic document modifications
- Automatic chunking for large documents
- Multi-agent support with conflict resolution
- Comprehensive CLI with 5 subcommands
- Full documentation for users and LLM agents
- 345 passing tests
