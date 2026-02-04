# Phase 7: Documentation & Integration Tests

> **Priority**: Medium  
> **Dependencies**: Phases 1-6  
> **Deliverables**: `README.md`, `SKILL.md`, integration tests

[← Back to Index](./index.md) | [← Phase 6](./phase-6-cli-rewrite.md)

---

## Objectives

1. Rewrite README.md with new CLI documentation
2. Update SKILL.md for AI agent consumption
3. Build comprehensive integration tests
4. Create test fixtures

---

## Module 7.1: README.md Updates

The README should be completely rewritten to document:

1. New CLI command structure
2. IR format specification
3. Edit format specification
4. Chunking behavior
5. Dual ID system explanation
6. Example workflows
7. Breaking changes from v1.x

### README.md Structure

```markdown
# superdoc-redlines

A Node.js CLI tool for applying tracked changes and comments to DOCX files using SuperDoc in headless mode.

Designed for use by AI agents (Claude, GPT, etc.) in IDE environments like Cursor, VS Code, or Claude Code.

## Features

- **Structured IR** - Extract stable block IDs from any DOCX
- **ID-Based Edits** - No fragile text matching
- **Auto-Chunking** - Handles documents of any size
- **Multi-Agent Support** - Merge edits from parallel agents
- **Track Changes** - Word-level diff produces minimal changes

## Installation

\`\`\`bash
npm install
\`\`\`

## Quick Start

\`\`\`bash
# 1. Extract document structure
node superdoc-redline.mjs extract --input contract.docx

# 2. Read document (LLM reads this)
node superdoc-redline.mjs read --input contract.docx

# 3. Create edits.json referencing block IDs
# 4. Apply edits
node superdoc-redline.mjs apply --input contract.docx --output redlined.docx --edits edits.json
\`\`\`

## CLI Commands

### extract
### read  
### validate
### apply
### merge

## Edit Format

[Edit JSON specification]

## IR Format

[Document IR specification]

## Chunking

[How chunking works]

## Multi-Agent Workflow

[Orchestrator-subagent pattern]
```

---

## Module 7.2: SKILL.md Updates

The SKILL.md (for LLM agent consumption) should be updated with:

1. New command reference
2. Example extract → read → edit → apply workflow
3. Chunking instructions
4. ID format reference (UUID vs seqId)

### Example SKILL.md Content

```markdown
---
name: superdoc-redlines
description: CLI tool for AI agents to apply tracked changes and comments to DOCX files
---

# SuperDoc Redlines Skill

## Overview

This tool allows AI agents to programmatically edit Word documents with:
- **Tracked changes** (insertions/deletions visible in Word's review mode)
- **Comments** (annotations attached to text ranges)

## Quick Workflow

### Step 1: Extract Document Structure
\`\`\`bash
node superdoc-redline.mjs extract --input contract.docx --output contract-ir.json
\`\`\`

### Step 2: Read Document (for analysis)
\`\`\`bash
# Read entire document (or first chunk if too large)
node superdoc-redline.mjs read --input contract.docx

# Read specific chunk
node superdoc-redline.mjs read --input contract.docx --chunk 1
\`\`\`

### Step 3: Create Edits File
\`\`\`json
{
  "edits": [
    { "blockId": "b025", "operation": "replace", "newText": "New content", "diff": true },
    { "blockId": "b089", "operation": "delete", "comment": "Removed per negotiation" }
  ]
}
\`\`\`

### Step 4: Apply Edits
\`\`\`bash
node superdoc-redline.mjs apply --input contract.docx --output redlined.docx --edits edits.json
\`\`\`

## Edit Operations

| Operation | Required Fields | Description |
|-----------|-----------------|-------------|
| `replace` | `blockId`, `newText` | Replace block content |
| `delete` | `blockId` | Delete block entirely |
| `comment` | `blockId`, `comment` | Add comment to block |
| `insert` | `afterBlockId`, `text` | Insert new block |

## ID Formats

Both formats are accepted:
- **seqId**: `b001`, `b025`, `b100` (human-readable, from IR extraction)
- **UUID**: `550e8400-e29b-41d4-a716-446655440000` (SuperDoc native)

## Large Documents

For documents with many tokens, use chunking:
\`\`\`bash
# Check if chunking is needed
node superdoc-redline.mjs read --input large.docx --stats-only

# Read chunks sequentially
node superdoc-redline.mjs read --input large.docx --chunk 0
node superdoc-redline.mjs read --input large.docx --chunk 1
\`\`\`

## Requirements

- Node.js 18+
- npm dependencies installed (`npm install` in tool directory)
```

---

## Module 7.3: Integration Tests

### File: `tests/integration.test.mjs`

```javascript
import { extractDocumentIR } from '../src/irExtractor.mjs';
import { applyEdits, validateEdits } from '../src/editApplicator.mjs';
import { readDocument } from '../src/documentReader.mjs';
import { mergeEditFiles } from '../src/editMerge.mjs';
import { readFile, writeFile, unlink } from 'fs/promises';

describe('Full Workflow Integration', () => {
  const testDoc = 'fixtures/asset-purchase.docx';
  const outputDoc = 'output/integration-test.docx';
  
  test('extract → read → validate → apply round trip', async () => {
    // 1. Extract IR
    const ir = await extractDocumentIR(testDoc);
    expect(ir.blocks.length).toBeGreaterThan(0);
    expect(ir.metadata.version).toBe('0.2.0');
    
    // 2. Read document
    const readResult = await readDocument(testDoc);
    expect(readResult.success).toBe(true);
    
    // 3. Create edits
    const editConfig = {
      version: '0.2.0',
      edits: [
        {
          blockId: ir.blocks[0].seqId,
          operation: 'comment',
          comment: 'Integration test comment'
        },
        {
          blockId: ir.blocks[5].seqId,
          operation: 'replace',
          newText: 'Modified text from integration test',
          diff: true
        }
      ]
    };
    
    // 4. Validate
    const validation = await validateEdits(testDoc, editConfig);
    expect(validation.valid).toBe(true);
    
    // 5. Apply
    const result = await applyEdits(testDoc, outputDoc, editConfig);
    expect(result.applied).toBe(2);
    expect(result.skipped.length).toBe(0);
    
    // 6. Verify output
    const outputBuffer = await readFile(outputDoc);
    expect(outputBuffer.length).toBeGreaterThan(0);
    // DOCX signature check
    expect(outputBuffer[0]).toBe(0x50);
    expect(outputBuffer[1]).toBe(0x4b);
  });
  
  test('handles invalid edits gracefully', async () => {
    const ir = await extractDocumentIR(testDoc);
    
    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Valid' },
        { blockId: 'b99999', operation: 'comment', comment: 'Invalid' }
      ]
    };
    
    const result = await applyEdits(testDoc, outputDoc, editConfig);
    expect(result.applied).toBe(1);
    expect(result.skipped.length).toBe(1);
  });
  
  test('multi-agent workflow end-to-end', async () => {
    const ir = await extractDocumentIR(testDoc);
    
    // Simulate sub-agent edits
    const editsA = {
      edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Agent A' }]
    };
    const editsB = {
      edits: [{ blockId: ir.blocks[10].seqId, operation: 'comment', comment: 'Agent B' }]
    };
    
    await writeFile('/tmp/test-edits-a.json', JSON.stringify(editsA));
    await writeFile('/tmp/test-edits-b.json', JSON.stringify(editsB));
    
    // Merge
    const mergeResult = await mergeEditFiles([
      '/tmp/test-edits-a.json',
      '/tmp/test-edits-b.json'
    ]);
    expect(mergeResult.success).toBe(true);
    expect(mergeResult.merged.edits.length).toBe(2);
    
    // Apply merged
    const applyResult = await applyEdits(testDoc, outputDoc, mergeResult.merged);
    expect(applyResult.applied).toBe(2);
    
    // Cleanup
    await unlink('/tmp/test-edits-a.json');
    await unlink('/tmp/test-edits-b.json');
  });
  
  test('chunking preserves all content', async () => {
    const ir = await extractDocumentIR(testDoc);
    
    // Force chunking with small token limit
    const chunk0 = await readDocument(testDoc, { maxTokens: 5000, chunkIndex: 0 });
    expect(chunk0.success).toBe(true);
    
    if (chunk0.totalChunks > 1) {
      // Collect all blocks from all chunks
      const allBlocks = [];
      for (let i = 0; i < chunk0.totalChunks; i++) {
        const chunk = await readDocument(testDoc, { maxTokens: 5000, chunkIndex: i });
        allBlocks.push(...chunk.document.blocks);
      }
      
      // All blocks should be present
      expect(allBlocks.length).toBe(ir.blocks.length);
      
      // No duplicates
      const ids = new Set(allBlocks.map(b => b.id));
      expect(ids.size).toBe(ir.blocks.length);
    }
  });
});

describe('Error Handling', () => {
  test('rejects non-existent input file', async () => {
    await expect(extractDocumentIR('nonexistent.docx')).rejects.toThrow();
  });
  
  test('rejects invalid DOCX file', async () => {
    await writeFile('/tmp/invalid.docx', 'not a docx');
    await expect(extractDocumentIR('/tmp/invalid.docx')).rejects.toThrow();
    await unlink('/tmp/invalid.docx');
  });
  
  test('rejects malformed edit config', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const badConfig = {
      edits: [{ operation: 'replace' }]  // Missing blockId and newText
    };
    
    const validation = await validateEdits('fixtures/sample.docx', badConfig);
    expect(validation.valid).toBe(false);
  });
});
```

---

## Test Fixtures

### Required Fixtures

```
tests/fixtures/
├── sample.docx           # Simple test document (existing)
├── asset-purchase.docx   # Complex contract from precedent library
└── large-document.docx   # Document for chunking tests (optional)
```

### Creating `asset-purchase.docx` Fixture

Copy from the precedent library:
```bash
cp "Business Transfer Agreement/Precedent - PLC - Asset purchase agreement.docx" \
   tests/fixtures/asset-purchase.docx
```

---

## Success Criteria

1. **README is complete**
   - All commands documented
   - Examples work correctly
   - Breaking changes noted

2. **SKILL.md is LLM-friendly**
   - Clear workflow steps
   - Minimal explanation, maximum examples
   - All operations covered

3. **Integration tests pass**
   - Full workflow works end-to-end
   - Error cases handled
   - Multi-agent workflow works

4. **All existing tests still pass**
   - No regressions in v1.x functionality that was kept

---

## Exit Conditions

- [ ] `README.md` completely rewritten
- [ ] `SKILL.md` updated for v0.2.0
- [ ] `tests/integration.test.mjs` implemented
- [ ] All integration tests pass
- [ ] `npm test` runs all tests successfully
- [ ] Test fixtures created

---

## Final Checklist (All Phases)

- [ ] **Phase 1**: Core infrastructure (idManager, editorFactory, irExtractor)
- [ ] **Phase 2**: Block operations (replace, delete, insert, comment)
- [ ] **Phase 3**: Validation & edit applicator
- [ ] **Phase 4**: Chunking & document reader
- [ ] **Phase 5**: Multi-agent merge
- [ ] **Phase 6**: CLI rewrite
- [ ] **Phase 7**: Documentation & integration tests

---

[← Back to Index](./index.md) | [← Phase 6](./phase-6-cli-rewrite.md)
