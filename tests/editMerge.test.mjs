/**
 * Tests for editMerge.mjs - Multi-agent edit file merging
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  mergeEditFiles,
  mergeEdits,
  validateMergedEdits,
  sortEditsForApplication,
  analyzeConflicts,
  createEmptyEditFile,
  splitBlocksForAgents
} from '../src/editMerge.mjs';

// Test fixtures directory
const TMP_DIR = '/tmp/editMerge-tests';

// Helper to create temp edit files
async function createTempEditFile(filename, edits) {
  const filePath = path.join(TMP_DIR, filename);
  await writeFile(filePath, JSON.stringify({ version: '0.2.0', edits }));
  return filePath;
}

// Sample IR for validation tests
const sampleIR = {
  blocks: [
    { id: 'uuid-001', seqId: 'b001', type: 'heading', text: 'Heading 1', startPos: 0, endPos: 50 },
    { id: 'uuid-002', seqId: 'b002', type: 'paragraph', text: 'Paragraph 1', startPos: 51, endPos: 100 },
    { id: 'uuid-003', seqId: 'b003', type: 'paragraph', text: 'Paragraph 2', startPos: 101, endPos: 150 },
    { id: 'uuid-004', seqId: 'b004', type: 'heading', text: 'Heading 2', startPos: 151, endPos: 200 },
    { id: 'uuid-005', seqId: 'b005', type: 'paragraph', text: 'Paragraph 3', startPos: 201, endPos: 250 },
    { id: 'uuid-006', seqId: 'b006', type: 'paragraph', text: 'Paragraph 4', startPos: 251, endPos: 300 },
  ]
};

describe('mergeEditFiles', () => {
  before(async () => {
    if (!existsSync(TMP_DIR)) {
      await mkdir(TMP_DIR, { recursive: true });
    }
  });

  after(async () => {
    if (existsSync(TMP_DIR)) {
      await rm(TMP_DIR, { recursive: true, force: true });
    }
  });

  it('merges non-conflicting edits from multiple files', async () => {
    const fileA = await createTempEditFile('edits-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'Comment A' }
    ]);
    const fileB = await createTempEditFile('edits-b.json', [
      { blockId: 'b002', operation: 'comment', comment: 'Comment B' }
    ]);

    const result = await mergeEditFiles([fileA, fileB]);

    assert.equal(result.success, true);
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.merged.edits.length, 2);
    assert.equal(result.stats.totalEdits, 2);
    assert.equal(result.stats.sourceFiles, 2);
  });

  it('preserves order of edits within each file', async () => {
    const fileA = await createTempEditFile('edits-order-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'First' },
      { blockId: 'b002', operation: 'comment', comment: 'Second' }
    ]);
    const fileB = await createTempEditFile('edits-order-b.json', [
      { blockId: 'b003', operation: 'comment', comment: 'Third' }
    ]);

    const result = await mergeEditFiles([fileA, fileB]);

    assert.equal(result.success, true);
    assert.equal(result.merged.edits[0].comment, 'First');
    assert.equal(result.merged.edits[1].comment, 'Second');
    assert.equal(result.merged.edits[2].comment, 'Third');
  });

  it('detects conflicts when same block edited twice', async () => {
    const fileA = await createTempEditFile('edits-conflict-a.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text A' }
    ]);
    const fileB = await createTempEditFile('edits-conflict-b.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text B' }
    ]);

    const result = await mergeEditFiles([fileA, fileB], { conflictStrategy: 'error' });

    assert.equal(result.success, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].blockId, 'b001');
    assert.ok(result.error.includes('conflict'));
  });

  it('resolves conflicts with first strategy', async () => {
    const fileA = await createTempEditFile('edits-first-a.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text A' }
    ]);
    const fileB = await createTempEditFile('edits-first-b.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text B' }
    ]);

    const result = await mergeEditFiles([fileA, fileB], { conflictStrategy: 'first' });

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 1);
    assert.equal(result.merged.edits[0].newText, 'Text A');
    assert.equal(result.conflicts[0].resolution, 'first');
  });

  it('resolves conflicts with last strategy', async () => {
    const fileA = await createTempEditFile('edits-last-a.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text A' }
    ]);
    const fileB = await createTempEditFile('edits-last-b.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text B' }
    ]);

    const result = await mergeEditFiles([fileA, fileB], { conflictStrategy: 'last' });

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 1);
    assert.equal(result.merged.edits[0].newText, 'Text B');
    assert.equal(result.conflicts[0].resolution, 'last');
  });

  it('combines comments with combine strategy', async () => {
    const fileA = await createTempEditFile('edits-combine-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'Comment A' }
    ]);
    const fileB = await createTempEditFile('edits-combine-b.json', [
      { blockId: 'b001', operation: 'comment', comment: 'Comment B' }
    ]);

    const result = await mergeEditFiles([fileA, fileB], { conflictStrategy: 'combine' });

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 1);
    assert.ok(result.merged.edits[0].comment.includes('Comment A'));
    assert.ok(result.merged.edits[0].comment.includes('Comment B'));
    assert.ok(result.merged.edits[0].comment.includes('---'));
    assert.equal(result.conflicts[0].resolution, 'combined');
  });

  it('combine strategy uses first for non-comment operations', async () => {
    const fileA = await createTempEditFile('edits-combine-rep-a.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text A' }
    ]);
    const fileB = await createTempEditFile('edits-combine-rep-b.json', [
      { blockId: 'b001', operation: 'replace', newText: 'Text B' }
    ]);

    const result = await mergeEditFiles([fileA, fileB], { conflictStrategy: 'combine' });

    assert.equal(result.success, true);
    assert.equal(result.merged.edits[0].newText, 'Text A');
    assert.equal(result.conflicts[0].resolution, 'first');
  });

  it('writes merged output to file when outputPath provided', async () => {
    const fileA = await createTempEditFile('edits-output-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'Test' }
    ]);
    const outputPath = path.join(TMP_DIR, 'merged-output.json');

    const result = await mergeEditFiles([fileA], { outputPath });

    assert.equal(result.success, true);
    assert.ok(existsSync(outputPath));
  });

  it('handles missing file gracefully', async () => {
    const result = await mergeEditFiles(['/nonexistent/file.json']);

    assert.equal(result.success, false);
    assert.ok(result.error.includes('Failed to read'));
  });

  it('handles invalid JSON gracefully', async () => {
    const invalidFile = path.join(TMP_DIR, 'invalid.json');
    await writeFile(invalidFile, 'not valid json');

    const result = await mergeEditFiles([invalidFile]);

    assert.equal(result.success, false);
    assert.ok(result.error.includes('Failed to parse JSON'));
  });

  it('handles missing edits array gracefully', async () => {
    const badFile = path.join(TMP_DIR, 'bad.json');
    await writeFile(badFile, JSON.stringify({ version: '0.2.0' }));

    const result = await mergeEditFiles([badFile]);

    assert.equal(result.success, false);
    assert.ok(result.error.includes('missing edits array'));
  });

  it('includes merge metadata in output', async () => {
    const fileA = await createTempEditFile('edits-meta-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'Test' }
    ]);

    const result = await mergeEditFiles([fileA], { conflictStrategy: 'first' });

    assert.ok(result.merged._mergeInfo);
    assert.ok(result.merged._mergeInfo.sourceFiles.includes(fileA));
    assert.equal(result.merged._mergeInfo.conflictStrategy, 'first');
    assert.ok(result.merged._mergeInfo.mergedAt);
  });

  it('removes internal _source tracking from output', async () => {
    const fileA = await createTempEditFile('edits-source-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'Test' }
    ]);

    const result = await mergeEditFiles([fileA]);

    assert.equal(result.merged.edits[0]._source, undefined);
  });
});

describe('mergeEdits (in-memory)', () => {
  it('merges edit objects directly', () => {
    const editsA = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'A' }] };
    const editsB = { edits: [{ blockId: 'b002', operation: 'comment', comment: 'B' }] };

    const result = mergeEdits([editsA, editsB]);

    assert.equal(result.success, true);
    assert.equal(result.merged.edits.length, 2);
  });

  it('handles conflicts the same as file-based merge', () => {
    const editsA = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'A' }] };
    const editsB = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'B' }] };

    const result = mergeEdits([editsA, editsB], { conflictStrategy: 'error' });

    assert.equal(result.success, false);
    assert.equal(result.conflicts.length, 1);
  });
});

describe('validateMergedEdits', () => {
  it('validates edits with valid block IDs', () => {
    const merged = {
      edits: [
        { blockId: 'b001', operation: 'comment', comment: 'test' },
        { blockId: 'uuid-002', operation: 'replace', newText: 'new' }
      ]
    };

    const result = validateMergedEdits(merged, sampleIR);

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  it('detects missing blocks', () => {
    const merged = {
      edits: [
        { blockId: 'b999', operation: 'comment', comment: 'test' }
      ]
    };

    const result = validateMergedEdits(merged, sampleIR);

    assert.equal(result.valid, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].type, 'missing_block');
    assert.equal(result.issues[0].blockId, 'b999');
  });

  it('detects delete-then-reference conflicts', () => {
    const merged = {
      edits: [
        { blockId: 'b001', operation: 'delete' },
        { afterBlockId: 'b001', operation: 'insert', text: 'new' }
      ]
    };

    const result = validateMergedEdits(merged, sampleIR);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.type === 'delete_then_reference'));
  });

  it('detects reference after delete in same edit set', () => {
    const merged = {
      edits: [
        { blockId: 'b002', operation: 'delete' },
        { blockId: 'b002', operation: 'comment', comment: 'test' }
      ]
    };

    const result = validateMergedEdits(merged, sampleIR);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.type === 'delete_then_reference'));
  });

  it('accepts valid seqId references', () => {
    const merged = {
      edits: [
        { blockId: 'b003', operation: 'comment', comment: 'valid seqId' }
      ]
    };

    const result = validateMergedEdits(merged, sampleIR);

    assert.equal(result.valid, true);
  });

  it('accepts valid UUID references', () => {
    const merged = {
      edits: [
        { blockId: 'uuid-003', operation: 'comment', comment: 'valid uuid' }
      ]
    };

    const result = validateMergedEdits(merged, sampleIR);

    assert.equal(result.valid, true);
  });
});

describe('sortEditsForApplication', () => {
  it('sorts edits by position descending', () => {
    const edits = [
      { blockId: 'b001', operation: 'replace', newText: 'first' },
      { blockId: 'b005', operation: 'replace', newText: 'middle' },
      { blockId: 'b006', operation: 'replace', newText: 'last' }
    ];

    const sorted = sortEditsForApplication(edits, sampleIR);

    // Last block (highest position) should be first
    assert.equal(sorted[0].newText, 'last');
    assert.equal(sorted[1].newText, 'middle');
    assert.equal(sorted[2].newText, 'first');
  });

  it('handles afterBlockId for insert operations', () => {
    const edits = [
      { afterBlockId: 'b001', operation: 'insert', text: 'after first' },
      { afterBlockId: 'b006', operation: 'insert', text: 'after last' }
    ];

    const sorted = sortEditsForApplication(edits, sampleIR);

    assert.equal(sorted[0].text, 'after last');
    assert.equal(sorted[1].text, 'after first');
  });

  it('handles mixed blockId and afterBlockId', () => {
    const edits = [
      { blockId: 'b002', operation: 'comment', comment: 'early' },
      { afterBlockId: 'b005', operation: 'insert', text: 'late' }
    ];

    const sorted = sortEditsForApplication(edits, sampleIR);

    assert.equal(sorted[0].text, 'late');
    assert.equal(sorted[1].comment, 'early');
  });

  it('preserves original array', () => {
    const edits = [
      { blockId: 'b001', operation: 'replace', newText: 'first' },
      { blockId: 'b006', operation: 'replace', newText: 'last' }
    ];

    const sorted = sortEditsForApplication(edits, sampleIR);

    // Original should be unchanged
    assert.equal(edits[0].newText, 'first');
    assert.notEqual(sorted, edits);
  });

  it('handles unknown block IDs gracefully', () => {
    const edits = [
      { blockId: 'unknown', operation: 'comment', comment: 'test' },
      { blockId: 'b001', operation: 'comment', comment: 'known' }
    ];

    // Should not throw
    const sorted = sortEditsForApplication(edits, sampleIR);
    assert.equal(sorted.length, 2);
  });
});

describe('analyzeConflicts', () => {
  before(async () => {
    if (!existsSync(TMP_DIR)) {
      await mkdir(TMP_DIR, { recursive: true });
    }
  });

  after(async () => {
    if (existsSync(TMP_DIR)) {
      await rm(TMP_DIR, { recursive: true, force: true });
    }
  });

  it('identifies blocks with multiple edits', async () => {
    const fileA = await createTempEditFile('analyze-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'A' }
    ]);
    const fileB = await createTempEditFile('analyze-b.json', [
      { blockId: 'b001', operation: 'comment', comment: 'B' }
    ]);

    const result = await analyzeConflicts([fileA, fileB]);

    assert.equal(result.hasConflicts, true);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.editCountsByBlock['b001'], 2);
  });

  it('reports no conflicts for non-overlapping edits', async () => {
    const fileA = await createTempEditFile('noconflict-a.json', [
      { blockId: 'b001', operation: 'comment', comment: 'A' }
    ]);
    const fileB = await createTempEditFile('noconflict-b.json', [
      { blockId: 'b002', operation: 'comment', comment: 'B' }
    ]);

    const result = await analyzeConflicts([fileA, fileB]);

    assert.equal(result.hasConflicts, false);
    assert.equal(result.conflicts.length, 0);
  });

  it('handles unreadable files gracefully', async () => {
    const result = await analyzeConflicts(['/nonexistent/file.json']);

    assert.equal(result.hasConflicts, false);
    assert.equal(result.conflicts.length, 0);
  });
});

describe('createEmptyEditFile', () => {
  it('creates valid edit file structure', () => {
    const editFile = createEmptyEditFile();

    assert.equal(editFile.version, '0.2.0');
    assert.deepEqual(editFile.edits, []);
    assert.ok(editFile._agentInfo);
    assert.ok(editFile._agentInfo.createdAt);
  });

  it('includes agent metadata when provided', () => {
    const editFile = createEmptyEditFile({
      agentId: 'definitions-agent',
      assignedRange: 'b001-b050'
    });

    assert.equal(editFile._agentInfo.agentId, 'definitions-agent');
    assert.equal(editFile._agentInfo.assignedRange, 'b001-b050');
  });
});

describe('splitBlocksForAgents', () => {
  it('splits blocks evenly among agents', () => {
    const ranges = splitBlocksForAgents(sampleIR, 2);

    assert.equal(ranges.length, 2);
    assert.equal(ranges[0].agentIndex, 0);
    assert.equal(ranges[1].agentIndex, 1);
    // Total blocks should be covered
    const totalBlocks = ranges.reduce((sum, r) => sum + r.blockCount, 0);
    assert.equal(totalBlocks, sampleIR.blocks.length);
  });

  it('handles single agent', () => {
    const ranges = splitBlocksForAgents(sampleIR, 1);

    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].startSeqId, 'b001');
    assert.equal(ranges[0].endSeqId, 'b006');
    assert.equal(ranges[0].blockCount, 6);
  });

  it('handles more agents than blocks', () => {
    const ranges = splitBlocksForAgents(sampleIR, 10);

    // Should not create empty ranges
    assert.ok(ranges.every(r => r.blockCount > 0));
    // Total blocks should still equal document blocks
    const totalBlocks = ranges.reduce((sum, r) => sum + r.blockCount, 0);
    assert.equal(totalBlocks, sampleIR.blocks.length);
  });

  it('handles empty IR', () => {
    const emptyIR = { blocks: [] };
    const ranges = splitBlocksForAgents(emptyIR, 3);

    assert.equal(ranges.length, 0);
  });

  it('handles zero agents', () => {
    const ranges = splitBlocksForAgents(sampleIR, 0);

    assert.equal(ranges.length, 0);
  });

  it('respects heading boundaries when enabled', () => {
    const ranges = splitBlocksForAgents(sampleIR, 2, { respectHeadings: true });

    // With respectHeadings, splits should try to occur at heading boundaries
    assert.equal(ranges.length, 2);
  });

  it('ignores heading boundaries when disabled', () => {
    const ranges = splitBlocksForAgents(sampleIR, 2, { respectHeadings: false });

    assert.equal(ranges.length, 2);
  });
});
