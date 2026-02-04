# Phase 5: Multi-Agent Merge

> **Priority**: High  
> **Dependencies**: Phases 1, 3  
> **Deliverables**: `editMerge.mjs`

[← Back to Index](./index.md) | [← Phase 4](./phase-4-chunking-reader.md)

---

## Objectives

1. Implement edit file merging from multiple sub-agents
2. Build conflict detection and resolution strategies
3. Validate merged edits against document IR
4. Support the orchestrator-subagent architecture

---

## Background: The Position Shift Problem

When multiple agents edit a document, a fundamental challenge arises:

```
Document: [Block A (pos 0-100)] [Block B (pos 100-200)] [Block C (pos 200-300)]

Agent 1: "Insert 50 chars into Block A"
  → Block A now: pos 0-150
  → Block B shifts to: pos 150-250  ← Position changed!
  → Block C shifts to: pos 250-350  ← Position changed!

Agent 2 (working in parallel): "Edit Block C at position 200"
  → FAILS: Block C is no longer at position 200!
```

## Harvey's Orchestrator-Subagent Architecture

From [Harvey's Word Add-In approach](https://www.harvey.ai/blog/enabling-document-wide-edits-in-harveys-word-add-in):

> "**Orchestrator** reads the full document, plans the work, and decomposes the request. **Subagents** perform localized edits on bounded chunks. **Global constraints** (tone, style, defined terms, cross-references) are enforced across chunks."

The key insight: **Sub-agents work on the Intermediate Representation, not the document directly.** They output declarative edit instructions. The system handles the actual document manipulation.

## Our Solution: ID-Based Declarative Edits

Our architecture naturally supports multi-agent workflows because:

1. **Sub-agents never see positions** - They only see block IDs from the IR
2. **IDs are stable** - Block IDs don't change when other blocks are edited
3. **Position resolution happens at apply time** - After all edits are collected

---

## Module: Edit Merger (`src/editMerge.mjs`)

### Purpose

Merge edit files from multiple sub-agents, detect conflicts, and produce a single unified edit file ready for application.

### Dependencies

```javascript
import { readFile, writeFile } from 'fs/promises';
```

### Main Exports

```javascript
/**
 * Merge multiple edit files from sub-agents into a single edit file.
 * Detects conflicts and resolves ordering issues.
 * 
 * @param {string[]} editFilePaths - Paths to edit JSON files from sub-agents
 * @param {MergeOptions} options
 * @returns {Promise<MergeResult>}
 * 
 * @typedef {Object} MergeOptions
 * @property {'error'|'first'|'last'|'combine'} conflictStrategy - How to handle conflicts
 *   - 'error': Fail if same block is edited by multiple sub-agents
 *   - 'first': Keep first edit encountered (by file order)
 *   - 'last': Keep last edit encountered (by file order)
 *   - 'combine': For comments, combine them; for other ops, use 'first'
 * @property {boolean} preserveOrder - Maintain relative order within each file (default: true)
 * @property {string} outputPath - Optional path to write merged edits
 */
export async function mergeEditFiles(editFilePaths, options = {}) {
  const {
    conflictStrategy = 'error',
    preserveOrder = true,
    outputPath = null
  } = options;
  
  const allEdits = [];
  const conflicts = [];
  const editsByBlockId = new Map();
  
  // Load and collect all edits
  for (let fileIndex = 0; fileIndex < editFilePaths.length; fileIndex++) {
    const filePath = editFilePaths[fileIndex];
    const content = await readFile(filePath, 'utf-8');
    const editFile = JSON.parse(content);
    
    for (let editIndex = 0; editIndex < editFile.edits.length; editIndex++) {
      const edit = editFile.edits[editIndex];
      const blockId = edit.blockId || edit.afterBlockId;
      
      // Track source for debugging
      edit._source = {
        file: filePath,
        fileIndex,
        editIndex
      };
      
      // Check for conflicts
      if (editsByBlockId.has(blockId)) {
        const existing = editsByBlockId.get(blockId);
        conflicts.push({
          blockId,
          edits: [existing, edit],
          resolution: null
        });
        
        // Handle based on strategy
        if (conflictStrategy === 'error') {
          // Will be reported in result
          continue;
        } else if (conflictStrategy === 'first') {
          // Keep existing, skip new
          conflicts[conflicts.length - 1].resolution = 'first';
          continue;
        } else if (conflictStrategy === 'last') {
          // Replace existing with new
          const idx = allEdits.findIndex(e => 
            (e.blockId || e.afterBlockId) === blockId
          );
          if (idx !== -1) {
            allEdits[idx] = edit;
          }
          editsByBlockId.set(blockId, edit);
          conflicts[conflicts.length - 1].resolution = 'last';
          continue;
        } else if (conflictStrategy === 'combine') {
          // Special handling for comments
          if (edit.operation === 'comment' && existing.operation === 'comment') {
            existing.comment = `${existing.comment}\n\n---\n\n${edit.comment}`;
            conflicts[conflicts.length - 1].resolution = 'combined';
            continue;
          }
          // Otherwise use 'first'
          conflicts[conflicts.length - 1].resolution = 'first';
          continue;
        }
      }
      
      editsByBlockId.set(blockId, edit);
      allEdits.push(edit);
    }
  }
  
  // Check for error strategy with conflicts
  if (conflictStrategy === 'error' && conflicts.length > 0) {
    return {
      success: false,
      error: `${conflicts.length} conflict(s) detected. Use a different conflictStrategy or resolve manually.`,
      conflicts,
      merged: null
    };
  }
  
  // Build merged edit file
  const merged = {
    version: '0.2.0',
    _mergeInfo: {
      sourceFiles: editFilePaths,
      mergedAt: new Date().toISOString(),
      conflictStrategy,
      conflictsResolved: conflicts.length
    },
    edits: allEdits.map(e => {
      // Remove internal tracking
      const { _source, ...cleanEdit } = e;
      return cleanEdit;
    })
  };
  
  // Optionally write to file
  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(merged, null, 2));
  }
  
  return {
    success: true,
    merged,
    conflicts,
    stats: {
      totalEdits: allEdits.length,
      sourceFiles: editFilePaths.length,
      conflictsDetected: conflicts.length
    }
  };
}
```

### `validateMergedEdits`

```javascript
/**
 * Validate that edits from multiple sub-agents don't have logical conflicts.
 * More thorough than basic merge - checks for semantic issues.
 * 
 * @param {Object} mergedEdits - Merged edit file
 * @param {DocumentIR} ir - Document IR for validation
 * @returns {ValidationResult}
 */
export function validateMergedEdits(mergedEdits, ir) {
  const issues = [];
  const blockIdSet = new Set(ir.blocks.map(b => b.id));
  const seqIdSet = new Set(ir.blocks.map(b => b.seqId));
  
  for (let i = 0; i < mergedEdits.edits.length; i++) {
    const edit = mergedEdits.edits[i];
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
    
    // Check for delete then reference
    const laterEdits = mergedEdits.edits.slice(i + 1);
    if (edit.operation === 'delete') {
      const laterRef = laterEdits.find(e => 
        e.afterBlockId === blockId || 
        (e.operation === 'replace' && e.blockId === blockId)
      );
      if (laterRef) {
        issues.push({
          editIndex: i,
          type: 'delete_then_reference',
          blockId,
          message: `Block ${blockId} is deleted but referenced by later edit`
        });
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
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

## Output Types

```typescript
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
    sourceFiles: string[];
    mergedAt: string;
    conflictStrategy: string;
    conflictsResolved: number;
  };
  edits: Edit[];
}
```

---

## Multi-Agent Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR-SUBAGENT WORKFLOW                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1: PREPARATION (Main Agent / Orchestrator)                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│                                                                      │
│  $ node superdoc-redline.mjs extract --input contract.docx           │
│                              │                                       │
│                              ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ contract-ir.json                                           │     │
│  │ {                                                          │     │
│  │   "blocks": [                                              │     │
│  │     { "id": "...", "seqId": "b001", "text": "1. DEFS..." },│     │
│  │     { "id": "...", "seqId": "b002", "text": "..." },       │     │
│  │     ...                                                    │     │
│  │     { "id": "...", "seqId": "b150", "text": "GOVERNING"}   │     │
│  │   ]                                                        │     │
│  │ }                                                          │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  PHASE 2: PARALLEL ANALYSIS (Sub-Agents)                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│                                                                      │
│  Main agent distributes work based on:                               │
│  - Document sections (by heading)                                    │
│  - Block ranges (b001-b050, b051-b100, etc.)                        │
│  - Topics (definitions, warranties, indemnities)                     │
│                                                                      │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐         │
│  │ SUB-AGENT A   │   │ SUB-AGENT B   │   │ SUB-AGENT C   │         │
│  │               │   │               │   │               │         │
│  │ Assigned:     │   │ Assigned:     │   │ Assigned:     │         │
│  │ Definitions   │   │ Warranties    │   │ Gov. Law      │         │
│  │ (b001-b050)   │   │ (b051-b100)   │   │ (b101-b150)   │         │
│  │               │   │               │   │               │         │
│  │ Works on IR   │   │ Works on IR   │   │ Works on IR   │         │
│  │ (read-only)   │   │ (read-only)   │   │ (read-only)   │         │
│  │               │   │               │   │               │         │
│  │ Outputs:      │   │ Outputs:      │   │ Outputs:      │         │
│  │ edits-a.json  │   │ edits-b.json  │   │ edits-c.json  │         │
│  └───────────────┘   └───────────────┘   └───────────────┘         │
│         │                   │                   │                   │
│         └───────────────────┼───────────────────┘                   │
│                             ▼                                        │
│  PHASE 3: MERGE (Main Agent)                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│                                                                      │
│  $ node superdoc-redline.mjs merge \                                 │
│      edits-a.json edits-b.json edits-c.json \                        │
│      --output merged-edits.json \                                    │
│      --conflict combine \                                            │
│      --validate contract.docx                                        │
│                             │                                        │
│                             ▼                                        │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Merge Process:                                              │     │
│  │ 1. Load all edit files                                      │     │
│  │ 2. Detect conflicts (same block edited twice)               │     │
│  │ 3. Apply conflict resolution strategy                       │     │
│  │ 4. Validate against document IR                             │     │
│  │ 5. Output merged-edits.json                                 │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  PHASE 4: APPLY (Main Agent)                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│                                                                      │
│  $ node superdoc-redline.mjs apply \                                 │
│      --input contract.docx \                                         │
│      --output redlined.docx \                                        │
│      --edits merged-edits.json                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Conflict Detection and Resolution

When multiple sub-agents might edit the same block:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `error` | Fail merge, report conflicts | Strict review workflows |
| `first` | Keep first edit (by file order) | Priority-based agents |
| `last` | Keep last edit (by file order) | Override pattern |
| `combine` | Merge comments; use `first` for other ops | Comment aggregation |

---

## Example: Multi-Agent Contract Review

**Scenario**: Review a 100-page asset purchase agreement with specialized sub-agents.

**Step 1: Main agent extracts IR and plans work**
```bash
# Extract IR
node superdoc-redline.mjs extract --input apa.docx --output apa-ir.json

# Read IR for planning
node superdoc-redline.mjs read --input apa.docx --stats-only
# Output: { "blockCount": 450, "estimatedTokens": 180000, "recommendedChunks": 2 }
```

**Step 2: Main agent distributes to specialized sub-agents**

```
Sub-Agent A: "Review definitions (b001-b100) for Singapore law compliance"
Sub-Agent B: "Review warranties (b101-b200) for seller-friendly language"
Sub-Agent C: "Review indemnities (b201-b300) for cap and basket issues"
Sub-Agent D: "Review governing law and disputes (b301-b450) for Singapore forum"
```

**Step 3: Each sub-agent outputs edits referencing block IDs**

```json
// edits-govlaw.json (from Sub-Agent D)
{
  "version": "0.2.0",
  "edits": [
    {
      "blockId": "b387",
      "operation": "replace",
      "newText": "This Agreement shall be governed by and construed in accordance with the laws of Singapore.",
      "comment": "Changed from English law to Singapore law per deal requirements",
      "diff": true
    },
    {
      "blockId": "b392",
      "operation": "replace", 
      "newText": "Any dispute arising out of or in connection with this Agreement shall be referred to and finally resolved by arbitration administered by the Singapore International Arbitration Centre.",
      "comment": "Changed from English courts to SIAC arbitration",
      "diff": true
    },
    {
      "blockId": "b401",
      "operation": "delete",
      "comment": "Removed Service of Process clause - not required for SIAC arbitration"
    }
  ]
}
```

**Step 4: Main agent merges all edits**
```bash
node superdoc-redline.mjs merge \
  edits-definitions.json \
  edits-warranties.json \
  edits-indemnities.json \
  edits-govlaw.json \
  --output merged-edits.json \
  --conflict combine \
  --validate apa.docx
```

**Step 5: Apply merged edits atomically**
```bash
node superdoc-redline.mjs apply \
  --input apa.docx \
  --output apa-redlined.docx \
  --edits merged-edits.json \
  --author-name "AI Review Team" \
  --author-email "ai@firm.com"
```

---

## Implementation Notes

1. **IR is read-only for sub-agents**: Sub-agents receive the IR and produce edit JSONs. They never modify the IR or the document directly.

2. **Block assignment is deterministic**: The orchestrator should assign non-overlapping block ranges to sub-agents to minimize conflicts.

3. **Global context in every chunk**: When using chunked reading, include the document outline in every chunk so sub-agents understand document structure.

4. **Merge before apply**: Always merge edit files from all sub-agents before applying. Never apply partial edits.

5. **Validate after merge**: Use the `--validate` flag to catch issues like:
   - Missing block IDs (block was deleted in IR)
   - Delete-then-reference conflicts
   - Overlapping edits resolved incorrectly

6. **Atomic application**: The apply phase loads the document once, applies all edits, and exports once. This ensures consistency.

---

## Test Requirements

### File: `tests/editMerge.test.mjs`

```javascript
describe('mergeEditFiles', () => {
  test('merges non-conflicting edits from multiple files', async () => {
    // Create test files
    const editsA = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'A' }] };
    const editsB = { edits: [{ blockId: 'b002', operation: 'comment', comment: 'B' }] };
    
    await writeFile('/tmp/edits-a.json', JSON.stringify(editsA));
    await writeFile('/tmp/edits-b.json', JSON.stringify(editsB));
    
    const result = await mergeEditFiles(['/tmp/edits-a.json', '/tmp/edits-b.json']);
    
    expect(result.success).toBe(true);
    expect(result.conflicts.length).toBe(0);
    expect(result.merged.edits.length).toBe(2);
  });
  
  test('detects conflicts when same block edited twice', async () => {
    const editsA = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'A' }] };
    const editsB = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'B' }] };
    
    await writeFile('/tmp/edits-a.json', JSON.stringify(editsA));
    await writeFile('/tmp/edits-b.json', JSON.stringify(editsB));
    
    const result = await mergeEditFiles(
      ['/tmp/edits-a.json', '/tmp/edits-b.json'],
      { conflictStrategy: 'error' }
    );
    
    expect(result.success).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].blockId).toBe('b001');
  });
  
  test('resolves conflicts with first strategy', async () => {
    const editsA = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'A' }] };
    const editsB = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'B' }] };
    
    await writeFile('/tmp/edits-a.json', JSON.stringify(editsA));
    await writeFile('/tmp/edits-b.json', JSON.stringify(editsB));
    
    const result = await mergeEditFiles(
      ['/tmp/edits-a.json', '/tmp/edits-b.json'],
      { conflictStrategy: 'first' }
    );
    
    expect(result.success).toBe(true);
    expect(result.merged.edits.length).toBe(1);
    expect(result.merged.edits[0].newText).toBe('A');
  });
  
  test('combines comments with combine strategy', async () => {
    const editsA = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'Comment A' }] };
    const editsB = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'Comment B' }] };
    
    await writeFile('/tmp/edits-a.json', JSON.stringify(editsA));
    await writeFile('/tmp/edits-b.json', JSON.stringify(editsB));
    
    const result = await mergeEditFiles(
      ['/tmp/edits-a.json', '/tmp/edits-b.json'],
      { conflictStrategy: 'combine' }
    );
    
    expect(result.success).toBe(true);
    expect(result.merged.edits[0].comment).toContain('Comment A');
    expect(result.merged.edits[0].comment).toContain('Comment B');
  });
});

describe('validateMergedEdits', () => {
  test('validates merged edits against IR', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const merged = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'test' }
      ]
    };
    
    const result = validateMergedEdits(merged, ir);
    expect(result.valid).toBe(true);
  });
  
  test('detects missing blocks', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const merged = {
      edits: [
        { blockId: 'b999', operation: 'comment', comment: 'test' }
      ]
    };
    
    const result = validateMergedEdits(merged, ir);
    expect(result.valid).toBe(false);
    expect(result.issues[0].type).toBe('missing_block');
  });
  
  test('detects delete-then-reference conflicts', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const merged = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'delete' },
        { afterBlockId: ir.blocks[0].seqId, operation: 'insert', text: 'new' }
      ]
    };
    
    const result = validateMergedEdits(merged, ir);
    expect(result.valid).toBe(false);
    expect(result.issues[0].type).toBe('delete_then_reference');
  });
});

describe('sortEditsForApplication', () => {
  test('sorts edits by position descending', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const edits = [
      { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'first' },
      { blockId: ir.blocks[5].seqId, operation: 'replace', newText: 'middle' },
      { blockId: ir.blocks[ir.blocks.length - 1].seqId, operation: 'replace', newText: 'last' }
    ];
    
    const sorted = sortEditsForApplication(edits, ir);
    
    // Last block should be first (highest position)
    expect(sorted[0].newText).toBe('last');
    expect(sorted[sorted.length - 1].newText).toBe('first');
  });
});
```

### File: `tests/multiAgent.test.mjs`

```javascript
describe('Multi-Agent Workflow', () => {
  test('full multi-agent workflow produces valid output', async () => {
    // Extract IR
    const ir = await extractDocumentIR('fixtures/sample.docx');
    
    // Simulate sub-agent outputs
    const editsA = { 
      edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Review A' }] 
    };
    const editsB = { 
      edits: [{ blockId: ir.blocks[5].seqId, operation: 'comment', comment: 'Review B' }] 
    };
    
    // Write temp files
    await writeFile('/tmp/edits-a.json', JSON.stringify(editsA));
    await writeFile('/tmp/edits-b.json', JSON.stringify(editsB));
    
    // Merge
    const mergeResult = await mergeEditFiles(['/tmp/edits-a.json', '/tmp/edits-b.json']);
    expect(mergeResult.success).toBe(true);
    
    // Validate
    const validation = validateMergedEdits(mergeResult.merged, ir);
    expect(validation.valid).toBe(true);
    
    // Apply
    const applyResult = await applyEdits(
      'fixtures/sample.docx',
      'output/multi-agent-test.docx',
      mergeResult.merged
    );
    expect(applyResult.applied).toBe(2);
  });
});
```

---

## Success Criteria

1. **Merge works correctly**
   - Combines edits from multiple files
   - Detects all conflicts
   - Applies resolution strategies correctly

2. **Validation catches issues**
   - Missing block IDs
   - Delete-then-reference conflicts
   - Operation-specific validation

3. **End-to-end workflow works**
   - Extract → Sub-agent edits → Merge → Apply produces valid output

---

## Exit Conditions

- [ ] `src/editMerge.mjs` implemented with all functions
- [ ] All conflict strategies work correctly
- [ ] `validateMergedEdits` catches all issue types
- [ ] All Phase 5 tests pass
- [ ] Multi-agent workflow produces valid documents

---

[← Back to Index](./index.md) | [← Phase 4](./phase-4-chunking-reader.md) | [Next: Phase 6 →](./phase-6-cli-rewrite.md)
