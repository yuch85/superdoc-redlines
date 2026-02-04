/**
 * Integration tests for multi-agent workflow.
 *
 * Tests the complete orchestrator-subagent workflow:
 * 1. Extract IR from document
 * 2. Simulate sub-agent edits
 * 3. Merge edits from multiple agents
 * 4. Validate merged edits
 * 5. Apply edits to produce final document
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractDocumentIR } from '../src/irExtractor.mjs';
import { applyEdits, validateEdits } from '../src/editApplicator.mjs';
import {
  mergeEditFiles,
  mergeEdits,
  validateMergedEdits,
  sortEditsForApplication,
  splitBlocksForAgents,
  createEmptyEditFile
} from '../src/editMerge.mjs';

// Test fixtures
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUTPUT_DIR = path.join(__dirname, 'output');
const TMP_DIR = '/tmp/multiAgent-tests';

// Sample DOCX for testing
const SAMPLE_DOCX = path.join(FIXTURES_DIR, 'sample.docx');

describe('Multi-Agent Workflow', () => {
  let ir;

  before(async () => {
    // Ensure directories exist
    if (!existsSync(OUTPUT_DIR)) {
      await mkdir(OUTPUT_DIR, { recursive: true });
    }
    if (!existsSync(TMP_DIR)) {
      await mkdir(TMP_DIR, { recursive: true });
    }

    // Skip if no sample document
    if (!existsSync(SAMPLE_DOCX)) {
      console.warn('Skipping multi-agent tests: sample.docx not found');
      return;
    }

    // Extract IR once for all tests
    ir = await extractDocumentIR(SAMPLE_DOCX);
  });

  after(async () => {
    if (existsSync(TMP_DIR)) {
      await rm(TMP_DIR, { recursive: true, force: true });
    }
  });

  it('extract IR provides block IDs for sub-agent work', async () => {
    if (!ir) return; // Skip if no IR

    assert.ok(ir.blocks.length > 0);
    assert.ok(ir.blocks[0].id);
    assert.ok(ir.blocks[0].seqId);
    assert.match(ir.blocks[0].seqId, /^b\d{3}$/);
  });

  it('sub-agents can reference blocks by seqId', async () => {
    if (!ir) return;

    // Simulate sub-agent creating edits referencing seqIds
    const subAgentEdits = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Sub-agent review' }
      ]
    };

    // Validate these edits work against the IR
    const validation = validateMergedEdits(subAgentEdits, ir);
    assert.equal(validation.valid, true);
  });

  it('full workflow: extract -> sub-agent edits -> merge -> validate', async () => {
    if (!ir) return;

    // Step 1: IR is already extracted

    // Step 2: Simulate sub-agent outputs
    const subAgentA = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Review from Agent A' }
      ]
    };

    const subAgentB = {
      edits: ir.blocks.length > 1
        ? [{ blockId: ir.blocks[1].seqId, operation: 'comment', comment: 'Review from Agent B' }]
        : []
    };

    // Write temp files (simulating sub-agent output)
    const fileA = path.join(TMP_DIR, 'edits-a.json');
    const fileB = path.join(TMP_DIR, 'edits-b.json');
    await writeFile(fileA, JSON.stringify(subAgentA));
    await writeFile(fileB, JSON.stringify(subAgentB));

    // Step 3: Merge
    const mergeResult = await mergeEditFiles([fileA, fileB]);
    assert.equal(mergeResult.success, true);
    assert.equal(mergeResult.conflicts.length, 0);

    // Step 4: Validate merged edits
    const validation = validateMergedEdits(mergeResult.merged, ir);
    assert.equal(validation.valid, true);
  });

  it('workflow handles conflicts between sub-agents', async () => {
    if (!ir) return;

    // Both agents edit the same block
    const subAgentA = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Agent A says' }
      ]
    };

    const subAgentB = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Agent B says' }
      ]
    };

    // Merge with combine strategy (should combine comments)
    const mergeResult = mergeEdits([subAgentA, subAgentB], { conflictStrategy: 'combine' });

    assert.equal(mergeResult.success, true);
    assert.equal(mergeResult.conflicts.length, 1);
    assert.ok(mergeResult.merged.edits[0].comment.includes('Agent A says'));
    assert.ok(mergeResult.merged.edits[0].comment.includes('Agent B says'));
  });

  it('workflow rejects conflicting edits with error strategy', async () => {
    if (!ir) return;

    const subAgentA = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'Version A' }
      ]
    };

    const subAgentB = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'Version B' }
      ]
    };

    const mergeResult = mergeEdits([subAgentA, subAgentB], { conflictStrategy: 'error' });

    assert.equal(mergeResult.success, false);
    assert.equal(mergeResult.conflicts.length, 1);
    assert.ok(mergeResult.error.includes('conflict'));
  });

  it('block range splitting for parallel agents', async () => {
    if (!ir) return;

    // Split work among 3 agents
    const ranges = splitBlocksForAgents(ir, 3);

    assert.ok(ranges.length <= 3);

    // Verify ranges cover all blocks
    let totalCovered = 0;
    for (const range of ranges) {
      totalCovered += range.blockCount;
      assert.ok(range.startSeqId);
      assert.ok(range.endSeqId);
    }
    assert.equal(totalCovered, ir.blocks.length);

    // Verify no overlaps
    const coveredSeqIds = new Set();
    for (const range of ranges) {
      const startIdx = ir.blocks.findIndex(b => b.seqId === range.startSeqId);
      const endIdx = ir.blocks.findIndex(b => b.seqId === range.endSeqId);
      for (let i = startIdx; i <= endIdx; i++) {
        assert.equal(coveredSeqIds.has(ir.blocks[i].seqId), false);
        coveredSeqIds.add(ir.blocks[i].seqId);
      }
    }
  });

  it('edits are sorted for safe application order', async () => {
    if (!ir || ir.blocks.length < 3) return;

    // Create edits at different positions
    const edits = [
      { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'first' },
      { blockId: ir.blocks[Math.floor(ir.blocks.length / 2)].seqId, operation: 'comment', comment: 'middle' },
      { blockId: ir.blocks[ir.blocks.length - 1].seqId, operation: 'comment', comment: 'last' }
    ];

    const sorted = sortEditsForApplication(edits, ir);

    // Last block (highest position) should be first in sorted order
    assert.equal(sorted[0].comment, 'last');
    assert.equal(sorted[sorted.length - 1].comment, 'first');
  });

  it('createEmptyEditFile provides valid template for sub-agents', () => {
    const editFile = createEmptyEditFile({
      agentId: 'legal-review-agent',
      assignedRange: 'b001-b050'
    });

    assert.equal(editFile.version, '0.2.0');
    assert.deepEqual(editFile.edits, []);
    assert.equal(editFile._agentInfo.agentId, 'legal-review-agent');
    assert.equal(editFile._agentInfo.assignedRange, 'b001-b050');
  });

  it('full end-to-end with document output', async () => {
    if (!ir) return;

    // Create sub-agent edit files
    const fileA = path.join(TMP_DIR, 'review-a.json');
    const fileB = path.join(TMP_DIR, 'review-b.json');

    const editsA = {
      version: '0.2.0',
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Reviewed by Agent A' }
      ]
    };

    const editsB = ir.blocks.length > 2 ? {
      version: '0.2.0',
      edits: [
        { blockId: ir.blocks[2].seqId, operation: 'comment', comment: 'Reviewed by Agent B' }
      ]
    } : { version: '0.2.0', edits: [] };

    await writeFile(fileA, JSON.stringify(editsA));
    await writeFile(fileB, JSON.stringify(editsB));

    // Merge
    const mergeResult = await mergeEditFiles([fileA, fileB]);
    assert.equal(mergeResult.success, true);

    // Validate
    const validation = validateMergedEdits(mergeResult.merged, ir);
    assert.equal(validation.valid, true);

    // Apply to document
    const outputPath = path.join(OUTPUT_DIR, 'multi-agent-result.docx');
    const applyResult = await applyEdits(
      SAMPLE_DOCX,
      outputPath,
      mergeResult.merged,
      {
        author: { name: 'Multi-Agent System', email: 'agents@test.com' }
      }
    );

    // Verify application
    assert.ok(applyResult.applied > 0);
    assert.ok(existsSync(outputPath));
  });

  it('handles mixed operation types from different agents', async () => {
    if (!ir || ir.blocks.length < 4) return;

    const agentOps = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Note' },
        { blockId: ir.blocks[1].seqId, operation: 'replace', newText: 'Updated text' },
        { afterBlockId: ir.blocks[2].seqId, operation: 'insert', text: 'New paragraph' }
      ]
    };

    const validation = validateMergedEdits(agentOps, ir);

    // All operations reference valid blocks
    assert.equal(validation.valid, true);
  });

  it('detects semantic issues in merged edits', async () => {
    if (!ir) return;

    // Delete a block then try to reference it
    const badMerge = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'delete' },
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'This should fail' }
      ]
    };

    const validation = validateMergedEdits(badMerge, ir);

    assert.equal(validation.valid, false);
    assert.ok(validation.issues.some(i => i.type === 'delete_then_reference'));
  });

  it('preserves agent edit order within files', async () => {
    if (!ir || ir.blocks.length < 2) return;

    const agentEdits = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'First' },
        { blockId: ir.blocks[1].seqId, operation: 'comment', comment: 'Second' }
      ]
    };

    const mergeResult = mergeEdits([agentEdits]);

    assert.equal(mergeResult.merged.edits[0].comment, 'First');
    assert.equal(mergeResult.merged.edits[1].comment, 'Second');
  });

  it('simulates realistic multi-agent contract review', async () => {
    if (!ir) return;

    // Simulate specialized agents for different parts of a contract

    // Definitions agent (first part of document)
    const definitionsAgent = createEmptyEditFile({ agentId: 'definitions' });
    if (ir.blocks.length > 0) {
      definitionsAgent.edits.push({
        blockId: ir.blocks[0].seqId,
        operation: 'comment',
        comment: 'Definition reviewed for Singapore law compliance'
      });
    }

    // General clauses agent (middle of document)
    const clausesAgent = createEmptyEditFile({ agentId: 'clauses' });
    const midIdx = Math.floor(ir.blocks.length / 2);
    if (midIdx > 0 && midIdx < ir.blocks.length) {
      clausesAgent.edits.push({
        blockId: ir.blocks[midIdx].seqId,
        operation: 'comment',
        comment: 'Clause reviewed - consider strengthening indemnity cap'
      });
    }

    // Merge agent outputs
    const mergeResult = mergeEdits([definitionsAgent, clausesAgent]);

    assert.equal(mergeResult.success, true);
    assert.ok(mergeResult.merged._mergeInfo);

    // Validate against document
    const validation = validateMergedEdits(mergeResult.merged, ir);
    assert.equal(validation.valid, true);
  });
});

describe('Edge Cases', () => {
  it('handles empty edit files', async () => {
    const emptyA = { edits: [] };
    const emptyB = { edits: [] };

    const result = mergeEdits([emptyA, emptyB]);

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 0);
    assert.equal(result.conflicts.length, 0);
  });

  it('handles single agent (no merge needed)', async () => {
    const singleAgent = {
      edits: [
        { blockId: 'b001', operation: 'comment', comment: 'Solo review' }
      ]
    };

    const result = mergeEdits([singleAgent]);

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 1);
  });

  it('handles many agents with no conflicts', async () => {
    const agents = [];
    for (let i = 0; i < 10; i++) {
      agents.push({
        edits: [
          { blockId: `b${String(i + 1).padStart(3, '0')}`, operation: 'comment', comment: `Agent ${i}` }
        ]
      });
    }

    const result = mergeEdits(agents);

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 10);
    assert.equal(result.conflicts.length, 0);
  });

  it('handles agent editing multiple blocks', async () => {
    const multiEditAgent = {
      edits: [
        { blockId: 'b001', operation: 'comment', comment: 'First' },
        { blockId: 'b002', operation: 'comment', comment: 'Second' },
        { blockId: 'b003', operation: 'replace', newText: 'Updated' },
        { afterBlockId: 'b004', operation: 'insert', text: 'New content' }
      ]
    };

    const result = mergeEdits([multiEditAgent]);

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 4);
  });
});
