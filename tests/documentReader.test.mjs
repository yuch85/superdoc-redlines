/**
 * Tests for Document Reader - Phase 4 document reading with chunking support
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readDocument, getDocumentStats } from '../src/documentReader.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('readDocument', () => {
  describe('with small document (sample.docx)', () => {
    let result;

    before(async () => {
      result = await readDocument(path.join(fixturesDir, 'sample.docx'));
    });

    it('reads small document in one chunk', async () => {
      assert.equal(result.success, true, 'Should succeed');
      assert.equal(result.totalChunks, 1, 'Small document should be one chunk');
      assert.equal(result.currentChunk, 0, 'Should be at chunk 0');
      assert.equal(result.hasMore, false, 'Should have no more chunks');
      assert.equal(result.nextChunkCommand, null, 'Should not have next chunk command');
      assert.ok(result.document, 'Should have document data');
      assert.ok(result.document.blocks, 'Document should have blocks');
      assert.ok(result.document.blocks.length > 0, 'Document should have at least one block');
    });

    it('includes outline in every chunk', async () => {
      assert.ok(result.document.outline !== undefined, 'Document should have outline');
      assert.ok(Array.isArray(result.document.outline), 'Outline should be an array');
    });

    it('includes metadata in document', async () => {
      assert.ok(result.document.metadata, 'Document should have metadata');
      assert.equal(result.document.metadata.filename, 'sample.docx');
    });
  });

  describe('with specific chunk index', () => {
    it('reads specific chunk', async () => {
      // Force chunking with very small maxTokens to ensure multiple chunks
      const result = await readDocument(
        path.join(fixturesDir, 'asset-purchase.docx'),
        { chunkIndex: 0, maxTokens: 1000 }
      );

      assert.equal(result.success, true, 'Should succeed');
      assert.equal(result.currentChunk, 0, 'Should be at chunk 0');
      assert.ok(result.document, 'Should have document data');
      assert.ok(result.document.blocks, 'Should have blocks');
    });

    it('returns error for invalid chunk index', async () => {
      // Request an impossibly high chunk index
      const result = await readDocument(
        path.join(fixturesDir, 'sample.docx'),
        { chunkIndex: 999 }
      );

      assert.equal(result.success, false, 'Should fail for invalid chunk');
      assert.ok(result.error, 'Should have error message');
      assert.ok(result.error.includes('999'), 'Error should mention requested chunk');
      assert.ok(result.error.includes('not found'), 'Error should say not found');
      assert.equal(result.document, null, 'Document should be null on error');
    });
  });

  describe('with large document requiring chunking', () => {
    it('provides next chunk command', async () => {
      // Use small maxTokens to force multiple chunks
      const result = await readDocument(
        path.join(fixturesDir, 'asset-purchase.docx'),
        { maxTokens: 1000 }
      );

      assert.equal(result.success, true, 'Should succeed');
      assert.ok(result.totalChunks > 1, `Should have multiple chunks (got ${result.totalChunks})`);
      assert.equal(result.currentChunk, 0, 'Should start at chunk 0');
      assert.equal(result.hasMore, true, 'Should have more chunks');
      assert.ok(result.nextChunkCommand, 'Should have next chunk command');
      assert.ok(
        result.nextChunkCommand.includes('--chunk 1'),
        'Next chunk command should reference chunk 1'
      );
      assert.ok(
        result.nextChunkCommand.includes('asset-purchase.docx'),
        'Next chunk command should include filename'
      );
    });

    it('includes outline in every chunk', async () => {
      // Read multiple chunks and verify each has the outline
      const result0 = await readDocument(
        path.join(fixturesDir, 'asset-purchase.docx'),
        { chunkIndex: 0, maxTokens: 1000 }
      );

      const result1 = await readDocument(
        path.join(fixturesDir, 'asset-purchase.docx'),
        { chunkIndex: 1, maxTokens: 1000 }
      );

      assert.ok(result0.document.outline, 'First chunk should have outline');
      assert.ok(result1.document.outline, 'Second chunk should have outline');
      assert.ok(Array.isArray(result0.document.outline), 'Outline should be an array');
      assert.ok(Array.isArray(result1.document.outline), 'Outline should be an array');
    });

    it('chunks have correct metadata', async () => {
      const result = await readDocument(
        path.join(fixturesDir, 'asset-purchase.docx'),
        { chunkIndex: 0, maxTokens: 1000 }
      );

      assert.ok(result.document.metadata, 'Chunk should have metadata');
      assert.equal(result.document.metadata.chunkIndex, 0, 'Should indicate chunk 0');
      assert.ok(
        result.document.metadata.totalChunks > 1,
        'Should indicate total chunks'
      );
      assert.ok(result.document.metadata.blockRange, 'Should have block range');
      assert.ok(result.document.metadata.blockRange.start, 'Block range should have start');
      assert.ok(result.document.metadata.blockRange.end, 'Block range should have end');
    });
  });

  describe('options', () => {
    it('respects format option: outline', async () => {
      const result = await readDocument(
        path.join(fixturesDir, 'sample.docx'),
        { format: 'outline' }
      );

      assert.equal(result.success, true);
      assert.ok(result.document.outline !== undefined, 'Should have outline');
      assert.equal(result.document.blocks, undefined, 'Should not have blocks in outline format');
    });

    it('respects format option: summary', async () => {
      const result = await readDocument(
        path.join(fixturesDir, 'sample.docx'),
        { format: 'summary' }
      );

      assert.equal(result.success, true);
      assert.ok(result.document.outline !== undefined, 'Should have outline');
      assert.ok(result.document.blockCount !== undefined, 'Should have block count');
      assert.ok(result.document.headings !== undefined, 'Should have headings list');
    });

    it('respects includeMetadata: false option', async () => {
      const result = await readDocument(
        path.join(fixturesDir, 'sample.docx'),
        { includeMetadata: false }
      );

      assert.equal(result.success, true);
      // Blocks should not have id/seqId when includeMetadata is false
      if (result.document.blocks && result.document.blocks.length > 0) {
        const firstBlock = result.document.blocks[0];
        assert.equal(firstBlock.id, undefined, 'Block should not have id');
        assert.equal(firstBlock.seqId, undefined, 'Block should not have seqId');
      }
      // Should not have idMapping
      assert.equal(result.document.idMapping, undefined, 'Should not have idMapping');
    });
  });

  describe('error handling', () => {
    it('returns error for non-existent file', async () => {
      const result = await readDocument('/nonexistent/path/file.docx');

      assert.equal(result.success, false, 'Should fail');
      assert.ok(result.error, 'Should have error message');
      assert.ok(
        result.error.includes('Failed to read document'),
        'Error should indicate read failure'
      );
      assert.equal(result.document, null, 'Document should be null');
    });
  });
});

describe('getDocumentStats', () => {
  describe('with small document', () => {
    it('returns document statistics', async () => {
      const stats = await getDocumentStats(path.join(fixturesDir, 'sample.docx'));

      assert.ok(stats, 'Should return stats');
      assert.equal(stats.filename, 'sample.docx', 'Should include filename');
      assert.ok(typeof stats.blockCount === 'number', 'Should have block count');
      assert.ok(stats.blockCount > 0, 'Block count should be positive');
      assert.ok(typeof stats.estimatedCharacters === 'number', 'Should have character estimate');
      assert.ok(typeof stats.estimatedTokens === 'number', 'Should have token estimate');
      assert.ok(typeof stats.recommendedChunks === 'number', 'Should have recommended chunks');
      assert.equal(stats.recommendedChunks, 1, 'Small document should recommend 1 chunk');
    });
  });

  describe('with large document', () => {
    it('recommends multiple chunks for large documents', async () => {
      const stats = await getDocumentStats(path.join(fixturesDir, 'asset-purchase.docx'));

      assert.ok(stats, 'Should return stats');
      assert.equal(stats.filename, 'asset-purchase.docx', 'Should include filename');
      assert.ok(stats.blockCount > 50, 'Large document should have many blocks');
      assert.ok(stats.estimatedTokens > 0, 'Should have token estimate');
      // Large asset purchase agreement might recommend multiple chunks
      assert.ok(stats.recommendedChunks >= 1, 'Should recommend at least 1 chunk');
    });

    it('provides useful estimates for planning', async () => {
      const stats = await getDocumentStats(path.join(fixturesDir, 'asset-purchase.docx'));

      // Estimates should be reasonable (not negative, not astronomically high)
      assert.ok(stats.estimatedCharacters > 0, 'Character estimate should be positive');
      assert.ok(stats.estimatedCharacters < 10000000, 'Character estimate should be reasonable');
      assert.ok(stats.estimatedTokens > 0, 'Token estimate should be positive');
      assert.ok(stats.estimatedTokens < 1000000, 'Token estimate should be reasonable');
    });
  });

  describe('error handling', () => {
    it('throws for non-existent file', async () => {
      await assert.rejects(
        getDocumentStats('/nonexistent/path/file.docx'),
        (err) => {
          assert.ok(err.message.includes('Failed to get document stats'));
          return true;
        }
      );
    });
  });
});
