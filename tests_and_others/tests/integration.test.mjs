/**
 * Integration Tests for superdoc-redlines v0.2.0
 *
 * Tests the full workflow: extract → read → validate → apply
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFile, writeFile, unlink, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { extractDocumentIR, createEditorWithIR } from '../../src/irExtractor.mjs';
import { applyEdits, validateEdits } from '../../src/editApplicator.mjs';
import { readDocument, getDocumentStats } from '../../src/documentReader.mjs';
import { mergeEditFiles, mergeEdits } from '../../src/editMerge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = join(__dirname, 'fixtures');
const OUTPUT_DIR = join(__dirname, 'output');

const SAMPLE_DOC = join(FIXTURES_DIR, 'sample.docx');
const ASSET_PURCHASE_DOC = join(FIXTURES_DIR, 'asset-purchase.docx');

// Ensure output directory exists
async function ensureOutputDir() {
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
  } catch (e) {
    // Directory may already exist
  }
}

describe('Full Workflow Integration', () => {
  const outputDoc = join(OUTPUT_DIR, 'integration-test.docx');

  before(async () => {
    await ensureOutputDir();
  });

  it('extract → read → validate → apply round trip with sample.docx', async () => {
    // 1. Extract IR
    const ir = await extractDocumentIR(SAMPLE_DOC);
    assert.ok(ir.blocks.length > 0, 'Should extract blocks');
    assert.strictEqual(ir.metadata.version, '0.2.0', 'Should be version 0.2.0');

    // 2. Read document
    const readResult = await readDocument(SAMPLE_DOC);
    assert.strictEqual(readResult.success, true, 'Read should succeed');
    assert.ok(readResult.document.blocks.length > 0, 'Should have blocks');

    // 3. Create edits using extracted seqIds
    const editConfig = {
      version: '0.2.0',
      edits: [
        {
          blockId: ir.blocks[0].seqId,
          operation: 'comment',
          comment: 'Integration test comment on first block'
        }
      ]
    };

    // 4. Validate
    const validation = await validateEdits(SAMPLE_DOC, editConfig);
    assert.strictEqual(validation.valid, true, 'Validation should pass');
    assert.strictEqual(validation.issues.length, 0, 'No validation issues');

    // 5. Apply
    const result = await applyEdits(SAMPLE_DOC, outputDoc, editConfig);
    assert.strictEqual(result.applied, 1, 'Should apply 1 edit');
    assert.strictEqual(result.skipped.length, 0, 'Should skip no edits');

    // 6. Verify output file exists and is valid DOCX
    const outputBuffer = await readFile(outputDoc);
    assert.ok(outputBuffer.length > 0, 'Output file should have content');
    // DOCX files are ZIP archives starting with PK
    assert.strictEqual(outputBuffer[0], 0x50, 'Should start with P');
    assert.strictEqual(outputBuffer[1], 0x4b, 'Should be K (ZIP signature)');
  });

  it('extract → read → validate → apply with asset-purchase.docx', async () => {
    // Check if asset-purchase.docx exists
    try {
      await stat(ASSET_PURCHASE_DOC);
    } catch (e) {
      // Skip if fixture doesn't exist
      return;
    }

    // 1. Extract IR
    const ir = await extractDocumentIR(ASSET_PURCHASE_DOC);
    assert.ok(ir.blocks.length > 0, 'Should extract blocks from asset purchase');

    // 2. Read document
    const readResult = await readDocument(ASSET_PURCHASE_DOC);
    assert.strictEqual(readResult.success, true, 'Read should succeed');

    // 3. Create multiple edits
    const editConfig = {
      version: '0.2.0',
      edits: [
        {
          blockId: ir.blocks[0].seqId,
          operation: 'comment',
          comment: 'First block comment'
        },
        {
          blockId: ir.blocks[Math.min(5, ir.blocks.length - 1)].seqId,
          operation: 'comment',
          comment: 'Another comment'
        }
      ]
    };

    // 4. Validate
    const validation = await validateEdits(ASSET_PURCHASE_DOC, editConfig);
    assert.strictEqual(validation.valid, true, 'Validation should pass');

    // 5. Apply
    const apOutputDoc = join(OUTPUT_DIR, 'integration-asset-purchase.docx');
    const result = await applyEdits(ASSET_PURCHASE_DOC, apOutputDoc, editConfig);
    assert.strictEqual(result.applied, 2, 'Should apply 2 edits');
    assert.strictEqual(result.skipped.length, 0, 'Should skip no edits');
  });

  it('handles replace operation with diff', async () => {
    const ir = await extractDocumentIR(SAMPLE_DOC);

    // Find a block with text
    const targetBlock = ir.blocks.find(b => b.text && b.text.length > 10);
    assert.ok(targetBlock, 'Should find block with text');

    const originalText = targetBlock.text;
    const newText = originalText.replace(/\w+/, 'REPLACED');

    const editConfig = {
      version: '0.2.0',
      edits: [
        {
          blockId: targetBlock.seqId,
          operation: 'replace',
          newText: newText,
          diff: true,
          comment: 'Test replacement'
        }
      ]
    };

    const replaceOutput = join(OUTPUT_DIR, 'integration-replace.docx');
    const result = await applyEdits(SAMPLE_DOC, replaceOutput, editConfig);
    assert.strictEqual(result.applied, 1, 'Should apply replace');

    // Verify output exists
    const outputBuffer = await readFile(replaceOutput);
    assert.ok(outputBuffer.length > 0, 'Should produce output');
  });
});

describe('Invalid Edit Handling', () => {
  const outputDoc = join(OUTPUT_DIR, 'integration-invalid.docx');

  before(async () => {
    await ensureOutputDir();
  });

  it('handles invalid blockId gracefully', async () => {
    const ir = await extractDocumentIR(SAMPLE_DOC);

    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Valid' },
        { blockId: 'b99999', operation: 'comment', comment: 'Invalid block' }
      ]
    };

    const result = await applyEdits(SAMPLE_DOC, outputDoc, editConfig);
    assert.strictEqual(result.applied, 1, 'Should apply 1 valid edit');
    assert.strictEqual(result.skipped.length, 1, 'Should skip 1 invalid edit');
    assert.ok(result.skipped[0].reason.includes('not found'), 'Should explain why skipped');
  });

  it('validates missing required fields', async () => {
    const editConfig = {
      edits: [
        { operation: 'replace' }  // Missing blockId and newText
      ]
    };

    const validation = await validateEdits(SAMPLE_DOC, editConfig);
    assert.strictEqual(validation.valid, false, 'Should be invalid');
    assert.ok(validation.issues.length > 0, 'Should have issues');
  });

  it('validates unknown operation', async () => {
    const ir = await extractDocumentIR(SAMPLE_DOC);

    const editConfig = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'unknown_op' }
      ]
    };

    const validation = await validateEdits(SAMPLE_DOC, editConfig);
    assert.strictEqual(validation.valid, false, 'Should be invalid');
  });
});

describe('Multi-Agent Workflow', () => {
  const outputDoc = join(OUTPUT_DIR, 'integration-multi-agent.docx');

  before(async () => {
    await ensureOutputDir();
  });

  it('merges edits from multiple agents (no conflicts)', async () => {
    // Use asset-purchase.docx which has many blocks (sample.docx only has 1)
    let testDoc = ASSET_PURCHASE_DOC;
    try {
      await stat(testDoc);
    } catch (e) {
      // Fall back to sample.docx if asset-purchase doesn't exist
      testDoc = SAMPLE_DOC;
    }

    // Use unique file names for this test
    const editsFileA = join(OUTPUT_DIR, 'merge-noconflict-a.json');
    const editsFileB = join(OUTPUT_DIR, 'merge-noconflict-b.json');

    const ir = await extractDocumentIR(testDoc);

    // Skip if document has fewer than 3 blocks
    if (ir.blocks.length < 3) {
      return; // Skip this test
    }

    // Agent A edits block 0
    const editsA = {
      version: '0.2.0',
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Agent A comment' }
      ]
    };

    // Agent B edits a DIFFERENT block (block 5 to ensure no overlap)
    const agentBBlockIndex = Math.min(5, ir.blocks.length - 1);
    const editsB = {
      version: '0.2.0',
      edits: [
        { blockId: ir.blocks[agentBBlockIndex].seqId, operation: 'comment', comment: 'Agent B comment' }
      ]
    };

    // Write edit files
    await writeFile(editsFileA, JSON.stringify(editsA, null, 2));
    await writeFile(editsFileB, JSON.stringify(editsB, null, 2));

    // Merge
    const mergeResult = await mergeEditFiles([editsFileA, editsFileB]);
    if (!mergeResult.success) {
      console.error('Merge failed:', mergeResult.error);
      console.error('Conflicts:', JSON.stringify(mergeResult.conflicts, null, 2));
    }
    assert.strictEqual(mergeResult.success, true, `Merge should succeed: ${mergeResult.error}`);
    assert.strictEqual(mergeResult.merged.edits.length, 2, 'Should have 2 merged edits');
    assert.strictEqual(mergeResult.stats.conflictsDetected, 0, 'Should have no conflicts');

    // Apply merged edits
    const outputMultiAgent = join(OUTPUT_DIR, 'multi-agent-noconflict.docx');
    const applyResult = await applyEdits(testDoc, outputMultiAgent, mergeResult.merged);
    assert.strictEqual(applyResult.applied, 2, 'Should apply 2 edits');

    // Cleanup
    try { await unlink(editsFileA); } catch (e) {}
    try { await unlink(editsFileB); } catch (e) {}
  });

  it('handles conflicting edits with combine strategy', async () => {
    // Use unique file names for this test
    const editsFileA = join(OUTPUT_DIR, 'merge-combine-a.json');
    const editsFileB = join(OUTPUT_DIR, 'merge-combine-b.json');

    const ir = await extractDocumentIR(SAMPLE_DOC);
    const sameBlockId = ir.blocks[0].seqId;

    // Both agents edit same block
    const editsA = {
      edits: [
        { blockId: sameBlockId, operation: 'comment', comment: 'Comment from Agent A' }
      ]
    };

    const editsB = {
      edits: [
        { blockId: sameBlockId, operation: 'comment', comment: 'Comment from Agent B' }
      ]
    };

    await writeFile(editsFileA, JSON.stringify(editsA, null, 2));
    await writeFile(editsFileB, JSON.stringify(editsB, null, 2));

    // Merge with combine strategy
    const mergeResult = await mergeEditFiles([editsFileA, editsFileB], {
      conflictStrategy: 'combine'
    });

    assert.strictEqual(mergeResult.success, true, 'Merge should succeed with combine');
    assert.strictEqual(mergeResult.merged.edits.length, 1, 'Should merge into 1 edit');
    assert.ok(
      mergeResult.merged.edits[0].comment.includes('Agent A') &&
      mergeResult.merged.edits[0].comment.includes('Agent B'),
      'Combined comment should include both agents'
    );

    // Cleanup
    try { await unlink(editsFileA); } catch (e) {}
    try { await unlink(editsFileB); } catch (e) {}
  });

  it('fails conflicting edits with error strategy', async () => {
    // Use unique file names for this test
    const editsFileA = join(OUTPUT_DIR, 'merge-error-a.json');
    const editsFileB = join(OUTPUT_DIR, 'merge-error-b.json');

    const ir = await extractDocumentIR(SAMPLE_DOC);
    const sameBlockId = ir.blocks[0].seqId;

    const editsA = {
      edits: [
        { blockId: sameBlockId, operation: 'replace', newText: 'Agent A text' }
      ]
    };

    const editsB = {
      edits: [
        { blockId: sameBlockId, operation: 'replace', newText: 'Agent B text' }
      ]
    };

    await writeFile(editsFileA, JSON.stringify(editsA, null, 2));
    await writeFile(editsFileB, JSON.stringify(editsB, null, 2));

    // Merge with error strategy (default)
    const mergeResult = await mergeEditFiles([editsFileA, editsFileB], {
      conflictStrategy: 'error'
    });

    assert.strictEqual(mergeResult.success, false, 'Merge should fail with error strategy');
    assert.ok(mergeResult.conflicts.length > 0, 'Should detect conflict');

    // Cleanup
    try { await unlink(editsFileA); } catch (e) {}
    try { await unlink(editsFileB); } catch (e) {}
  });
});

describe('Chunking Integration', () => {
  before(async () => {
    await ensureOutputDir();
  });

  it('reads document with stats', async () => {
    const stats = await getDocumentStats(SAMPLE_DOC);

    assert.ok(stats.filename, 'Should have filename');
    assert.ok(stats.blockCount > 0, 'Should have block count');
    assert.ok(stats.estimatedTokens > 0, 'Should have token estimate');
    assert.ok(stats.recommendedChunks >= 1, 'Should recommend at least 1 chunk');
  });

  it('respects chunk boundaries', async () => {
    // Force chunking with small token limit
    const result = await readDocument(SAMPLE_DOC, {
      maxTokens: 1000,
      chunkIndex: 0
    });

    assert.strictEqual(result.success, true, 'Read should succeed');
    assert.ok(result.totalChunks >= 1, 'Should have at least 1 chunk');

    if (result.totalChunks > 1) {
      assert.strictEqual(result.hasMore, true, 'Should indicate more chunks');
      assert.ok(result.nextChunkCommand, 'Should provide next chunk command');
    }
  });

  it('preserves all content across chunks', async () => {
    const ir = await extractDocumentIR(SAMPLE_DOC);

    // Force multiple chunks
    const allBlocks = [];
    let chunkIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await readDocument(SAMPLE_DOC, {
        maxTokens: 2000,
        chunkIndex: chunkIndex
      });

      assert.strictEqual(result.success, true, `Chunk ${chunkIndex} should succeed`);
      allBlocks.push(...result.document.blocks);
      hasMore = result.hasMore;
      chunkIndex++;

      // Safety limit
      if (chunkIndex > 100) break;
    }

    // All blocks from IR should be present in chunks
    assert.strictEqual(
      allBlocks.length,
      ir.blocks.length,
      'All blocks should be present across chunks'
    );

    // No duplicates
    const ids = new Set(allBlocks.map(b => b.id));
    assert.strictEqual(ids.size, ir.blocks.length, 'Should have no duplicate blocks');
  });

  it('includes outline in every chunk', async () => {
    // Force chunking
    const chunk0 = await readDocument(SAMPLE_DOC, {
      maxTokens: 1000,
      chunkIndex: 0
    });

    assert.ok(chunk0.document.outline, 'Chunk 0 should have outline');

    if (chunk0.totalChunks > 1) {
      const chunk1 = await readDocument(SAMPLE_DOC, {
        maxTokens: 1000,
        chunkIndex: 1
      });

      assert.ok(chunk1.document.outline, 'Chunk 1 should also have outline');
      // Outlines should be the same
      assert.deepStrictEqual(
        chunk0.document.outline,
        chunk1.document.outline,
        'Outline should be same in all chunks'
      );
    }
  });
});

describe('Error Handling', () => {
  it('rejects non-existent input file for extract', async () => {
    await assert.rejects(
      extractDocumentIR('/nonexistent/path/doc.docx'),
      /ENOENT|not found/i,
      'Should reject non-existent file'
    );
  });

  it('rejects non-existent input file for read', async () => {
    const result = await readDocument('/nonexistent/path/doc.docx');
    assert.strictEqual(result.success, false, 'Should fail');
    assert.ok(result.error, 'Should have error message');
  });

  it('handles empty edits array', async () => {
    const editConfig = { edits: [] };
    const outputDoc = join(OUTPUT_DIR, 'integration-empty.docx');

    const result = await applyEdits(SAMPLE_DOC, outputDoc, editConfig);
    assert.strictEqual(result.applied, 0, 'Should apply 0 edits');
    assert.strictEqual(result.skipped.length, 0, 'Should skip 0 edits');
  });
});

describe('ID Format Compatibility', () => {
  it('seqIds are stable across document loads', async () => {
    // Extract IR twice to verify seqIds are deterministic
    const ir1 = await extractDocumentIR(SAMPLE_DOC);
    const ir2 = await extractDocumentIR(SAMPLE_DOC);

    // seqIds should be identical
    assert.strictEqual(ir1.blocks[0].seqId, ir2.blocks[0].seqId, 'seqIds should be stable');

    // UUIDs will be DIFFERENT (this is expected behavior per DOC.md Decision 1)
    // SuperDoc generates fresh UUIDs on each document load
    assert.notStrictEqual(ir1.blocks[0].id, ir2.blocks[0].id, 'UUIDs change on reload');

    // seqId-based edits work across sessions
    const editConfig = {
      edits: [
        { blockId: ir1.blocks[0].seqId, operation: 'comment', comment: 'Via seqId' }
      ]
    };

    // Validate in a new session (different UUIDs) but seqId still works
    const validation = await validateEdits(SAMPLE_DOC, editConfig);
    assert.strictEqual(validation.valid, true, 'seqId-based edits should validate');
  });

  it('accepts seqId format for editing', async () => {
    const ir = await extractDocumentIR(SAMPLE_DOC);

    const editWithSeqId = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Via seqId' }
      ]
    };

    const validation = await validateEdits(SAMPLE_DOC, editWithSeqId);
    assert.strictEqual(validation.valid, true, 'seqId should be valid for validation');
  });
});
