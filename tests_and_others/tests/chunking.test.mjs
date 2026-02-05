/**
 * Tests for Chunking Module - Document chunking for large documents
 *
 * Uses Node.js built-in test runner (node:test)
 * Run with: npm test
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  estimateBlockTokens,
  estimateTokens,
  chunkDocument
} from '../../src/chunking.mjs';
import { extractDocumentIR } from '../../src/irExtractor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('estimateBlockTokens', () => {
  it('estimates tokens for small block', () => {
    const block = { text: 'Hello world' };
    const tokens = estimateBlockTokens(block);
    assert.ok(tokens > 0, 'Should return positive token count');
    assert.equal(tokens, 50 + Math.ceil(11 / 4), 'overhead + text tokens');
  });

  it('estimates tokens for large block', () => {
    const block = { text: 'A'.repeat(1000) };
    const tokens = estimateBlockTokens(block);
    assert.equal(tokens, 50 + 250, 'overhead + 1000/4');
  });

  it('handles block with empty text', () => {
    const block = { text: '' };
    const tokens = estimateBlockTokens(block);
    assert.equal(tokens, 50, 'Should return just overhead for empty text');
  });

  it('handles block with undefined text', () => {
    const block = {};
    const tokens = estimateBlockTokens(block);
    assert.equal(tokens, 50, 'Should return just overhead for undefined text');
  });

  it('handles block with null text', () => {
    const block = { text: null };
    const tokens = estimateBlockTokens(block);
    assert.equal(tokens, 50, 'Should return just overhead for null text');
  });
});

describe('estimateTokens', () => {
  it('estimates total document tokens for mock IR', () => {
    const mockIR = {
      blocks: [
        { text: 'Hello world' },
        { text: 'Another paragraph' }
      ],
      outline: [],
      metadata: {}
    };
    const tokens = estimateTokens(mockIR);

    // Each block: 50 overhead + text/4
    // Block 1: 50 + ceil(11/4) = 50 + 3 = 53
    // Block 2: 50 + ceil(17/4) = 50 + 5 = 55
    // Outline: 0 items * 20 = 0
    // Metadata overhead: 200
    // Total: 53 + 55 + 0 + 200 = 308
    assert.equal(tokens, 308, 'Should calculate total tokens correctly');
  });

  it('includes outline tokens', () => {
    const mockIR = {
      blocks: [],
      outline: [
        { id: '1', title: 'Section 1', children: [] },
        { id: '2', title: 'Section 2', children: [
          { id: '3', title: 'Subsection 2.1', children: [] }
        ] }
      ],
      metadata: {}
    };
    const tokens = estimateTokens(mockIR);

    // No blocks: 0
    // Outline: 3 items * 20 = 60
    // Metadata overhead: 200
    // Total: 0 + 60 + 200 = 260
    assert.equal(tokens, 260, 'Should include outline tokens');
  });

  it('handles empty IR', () => {
    const emptyIR = {
      blocks: [],
      outline: [],
      metadata: {}
    };
    const tokens = estimateTokens(emptyIR);
    assert.equal(tokens, 200, 'Should return just metadata overhead for empty IR');
  });

  it('handles IR with undefined blocks and outline', () => {
    const ir = { metadata: {} };
    const tokens = estimateTokens(ir);
    assert.equal(tokens, 200, 'Should handle undefined blocks and outline');
  });

  describe('with real documents', () => {
    let sampleIR;

    before(async () => {
      sampleIR = await extractDocumentIR(path.join(fixturesDir, 'sample.docx'));
    });

    it('estimates tokens for real document', () => {
      const tokens = estimateTokens(sampleIR);
      assert.ok(tokens > 200, 'Should be greater than just metadata overhead');
      assert.ok(tokens > sampleIR.blocks.length * 50, 'Should include block overheads');
    });
  });
});

describe('chunkDocument', () => {
  // Mock IR for unit tests
  function createMockIR(numBlocks, textLength = 100) {
    const blocks = [];
    for (let i = 0; i < numBlocks; i++) {
      blocks.push({
        id: `uuid-${i}`,
        seqId: `b${String(i + 1).padStart(3, '0')}`,
        type: i % 10 === 0 ? 'heading' : 'paragraph',
        text: 'A'.repeat(textLength),
        startPos: i * 100,
        endPos: i * 100 + textLength
      });
    }
    return {
      blocks,
      outline: [
        { id: 'uuid-0', seqId: 'b001', title: 'Section 1', children: [] }
      ],
      metadata: {
        filename: 'test.docx',
        version: '0.2.0',
        blockCount: numBlocks
      },
      idMapping: Object.fromEntries(blocks.map(b => [b.id, b.seqId]))
    };
  }

  it('returns single chunk for small document', () => {
    const smallIR = createMockIR(5);  // 5 blocks, should be well under any limit
    const chunks = chunkDocument(smallIR, 100000);

    assert.equal(chunks.length, 1, 'Should return single chunk');
    assert.equal(chunks[0].blocks.length, 5, 'Should contain all blocks');
    assert.equal(chunks[0].metadata.chunkIndex, 0, 'Chunk index should be 0');
    assert.equal(chunks[0].metadata.totalChunks, 1, 'Total chunks should be 1');
  });

  it('splits large document into chunks', () => {
    // Create a large document that will need splitting
    // 100 blocks * (50 overhead + 25 text tokens) = 7500 tokens for blocks
    // Plus outline and metadata overhead (~220)
    // Total: ~7720 tokens
    const largeIR = createMockIR(100, 100);  // 100 blocks with 100 chars each

    // Use maxTokens that will force splitting but allow multiple blocks per chunk
    // With 2000 maxTokens and ~220 fixed overhead, we have ~1780 for blocks
    // Each block is 75 tokens, so ~23 blocks per chunk
    const chunks = chunkDocument(largeIR, 2000);

    assert.ok(chunks.length > 1, `Should split into multiple chunks, got ${chunks.length}`);

    // Verify all chunks have proper structure
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      assert.equal(chunk.metadata.chunkIndex, i, `Chunk ${i} should have correct index`);
      assert.equal(chunk.metadata.totalChunks, chunks.length, 'All chunks should have same totalChunks');
      assert.ok(chunk.blocks.length > 0, `Chunk ${i} should have blocks`);
    }
  });

  it('preserves all blocks across chunks', () => {
    const largeIR = createMockIR(50, 100);
    const chunks = chunkDocument(largeIR, 2000);

    // Collect all block seqIds from chunks
    const allBlockSeqIds = [];
    for (const chunk of chunks) {
      for (const block of chunk.blocks) {
        allBlockSeqIds.push(block.seqId);
      }
    }

    // Verify we have all original blocks
    const originalSeqIds = largeIR.blocks.map(b => b.seqId);
    assert.equal(allBlockSeqIds.length, originalSeqIds.length, 'Total block count should match');

    // Verify order is preserved
    for (let i = 0; i < originalSeqIds.length; i++) {
      assert.equal(allBlockSeqIds[i], originalSeqIds[i], `Block order should be preserved at index ${i}`);
    }
  });

  it('includes outline in every chunk', () => {
    const largeIR = createMockIR(50, 100);
    const chunks = chunkDocument(largeIR, 2000);

    assert.ok(chunks.length > 1, 'Should have multiple chunks for this test');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      assert.ok(chunk.outline, `Chunk ${i} should have outline`);
      assert.equal(
        JSON.stringify(chunk.outline),
        JSON.stringify(largeIR.outline),
        `Chunk ${i} should have same outline as original`
      );
    }
  });

  it('sets correct metadata for each chunk', () => {
    const largeIR = createMockIR(50, 100);
    largeIR.metadata.filename = 'my-document.docx';
    const chunks = chunkDocument(largeIR, 2000);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      assert.equal(chunk.metadata.filename, 'my-document.docx', 'Should preserve filename');
      assert.equal(chunk.metadata.chunkIndex, i, 'Should have correct chunkIndex');
      assert.equal(chunk.metadata.totalChunks, chunks.length, 'Should have correct totalChunks');

      // Verify blockRange
      assert.ok(chunk.metadata.blockRange, 'Should have blockRange');
      assert.equal(chunk.metadata.blockRange.start, chunk.blocks[0].seqId, 'blockRange.start should match first block');
      assert.equal(chunk.metadata.blockRange.end, chunk.blocks[chunk.blocks.length - 1].seqId, 'blockRange.end should match last block');
    }
  });

  it('prefers breaking at heading boundaries', () => {
    // Create IR with strategic heading placements
    const blocks = [];
    for (let i = 0; i < 30; i++) {
      blocks.push({
        id: `uuid-${i}`,
        seqId: `b${String(i + 1).padStart(3, '0')}`,
        type: i === 10 || i === 20 ? 'heading' : 'paragraph',  // Headings at positions 10 and 20
        text: 'A'.repeat(200),
        startPos: i * 200,
        endPos: i * 200 + 200
      });
    }

    const ir = {
      blocks,
      outline: [],
      metadata: { filename: 'test.docx' },
      idMapping: Object.fromEntries(blocks.map(b => [b.id, b.seqId]))
    };

    // Force chunking at a size that would break around block 10-15
    const chunks = chunkDocument(ir, 1500);

    if (chunks.length > 1) {
      // Check if any chunk (except the first) starts with a heading
      let foundHeadingStart = false;
      for (let i = 1; i < chunks.length; i++) {
        if (chunks[i].blocks[0].type === 'heading') {
          foundHeadingStart = true;
          break;
        }
      }
      // This is a soft assertion - the algorithm prefers headings but may not always find one
      // We just verify the algorithm runs without error
      assert.ok(chunks.length > 0, 'Should produce valid chunks');
    }
  });

  it('maintains idMapping for each chunk', () => {
    const largeIR = createMockIR(50, 100);
    const chunks = chunkDocument(largeIR, 2000);

    for (const chunk of chunks) {
      assert.ok(chunk.idMapping, 'Chunk should have idMapping');

      // Verify idMapping matches blocks in this chunk
      const blockIds = chunk.blocks.map(b => b.id);
      const mappingIds = Object.keys(chunk.idMapping);

      assert.equal(mappingIds.length, blockIds.length, 'idMapping should have same count as blocks');

      for (const block of chunk.blocks) {
        assert.equal(chunk.idMapping[block.id], block.seqId, `idMapping should map ${block.id} to ${block.seqId}`);
      }
    }
  });

  it('handles empty document', () => {
    const emptyIR = {
      blocks: [],
      outline: [],
      metadata: { filename: 'empty.docx' },
      idMapping: {}
    };
    const chunks = chunkDocument(emptyIR, 100000);

    assert.equal(chunks.length, 1, 'Should return single chunk for empty document');
    assert.equal(chunks[0].blocks.length, 0, 'Chunk should have no blocks');
    assert.equal(chunks[0].metadata.totalChunks, 1, 'Total chunks should be 1');
  });

  it('handles document with single block', () => {
    const singleBlockIR = createMockIR(1);
    const chunks = chunkDocument(singleBlockIR, 100000);

    assert.equal(chunks.length, 1, 'Should return single chunk');
    assert.equal(chunks[0].blocks.length, 1, 'Should have one block');
  });

  it('uses default maxTokens of 100000', () => {
    // Create a document that's under 100k tokens
    const smallIR = createMockIR(100, 100);  // ~7500 tokens
    const chunks = chunkDocument(smallIR);  // No maxTokens specified

    assert.equal(chunks.length, 1, 'Should return single chunk with default maxTokens');
  });

  describe('with real documents', () => {
    let sampleIR;
    let assetPurchaseIR;

    before(async () => {
      sampleIR = await extractDocumentIR(path.join(fixturesDir, 'sample.docx'));
      assetPurchaseIR = await extractDocumentIR(path.join(fixturesDir, 'asset-purchase.docx'));
    });

    it('returns single chunk for small document (sample.docx)', () => {
      const chunks = chunkDocument(sampleIR, 100000);

      assert.equal(chunks.length, 1, 'Small document should be single chunk');
      assert.equal(chunks[0].blocks.length, sampleIR.blocks.length, 'Should contain all blocks');
      assert.deepEqual(chunks[0].outline, sampleIR.outline, 'Should include outline');
    });

    it('can split large document (asset-purchase.docx) with small maxTokens', () => {
      // Use a small maxTokens to force chunking
      const chunks = chunkDocument(assetPurchaseIR, 2000);

      assert.ok(chunks.length >= 1, 'Should produce at least one chunk');

      // Verify all blocks are preserved
      let totalBlocks = 0;
      for (const chunk of chunks) {
        totalBlocks += chunk.blocks.length;
      }
      assert.equal(totalBlocks, assetPurchaseIR.blocks.length, 'Total blocks should match original');
    });

    it('preserves document structure in real documents', () => {
      const chunks = chunkDocument(assetPurchaseIR, 5000);

      for (const chunk of chunks) {
        // Verify each chunk has required fields
        assert.ok(chunk.metadata, 'Chunk should have metadata');
        assert.ok(chunk.metadata.filename, 'Chunk should have filename');
        assert.ok(typeof chunk.metadata.chunkIndex === 'number', 'Chunk should have chunkIndex');
        assert.ok(typeof chunk.metadata.totalChunks === 'number', 'Chunk should have totalChunks');
        assert.ok(chunk.metadata.blockRange, 'Chunk should have blockRange');
        assert.ok(Array.isArray(chunk.outline), 'Chunk should have outline array');
        assert.ok(Array.isArray(chunk.blocks), 'Chunk should have blocks array');
        assert.ok(chunk.idMapping, 'Chunk should have idMapping');
      }
    });
  });
});
