/**
 * Tests for IR Extractor - Document extraction with stable block IDs
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentIR } from '../../src/irExtractor.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('extractDocumentIR', () => {
  describe('with sample.docx', () => {
    let ir;

    before(async () => {
      ir = await extractDocumentIR(path.join(fixturesDir, 'sample.docx'));
    });

    it('extracts blocks with IDs', async () => {
      assert.ok(ir.blocks.length > 0, 'Should extract at least one block');
      assert.ok(ir.blocks.every(b => b.id), 'Every block should have an id');
      assert.ok(ir.blocks.every(b => b.seqId), 'Every block should have a seqId');
    });

    it('assigns sequential IDs in order', async () => {
      const seqIds = ir.blocks.map(b => b.seqId);
      assert.equal(seqIds[0], 'b001');
      if (seqIds.length > 1) {
        assert.equal(seqIds[1], 'b002');
      }
    });

    it('includes metadata', async () => {
      assert.ok(ir.metadata);
      assert.equal(ir.metadata.filename, 'sample.docx');
      assert.equal(ir.metadata.version, '0.2.0');
      assert.ok(ir.metadata.generated);
      assert.equal(ir.metadata.blockCount, ir.blocks.length);
    });

    it('produces valid idMapping', async () => {
      assert.ok(ir.idMapping);
      assert.equal(Object.keys(ir.idMapping).length, ir.blocks.length);

      for (const block of ir.blocks) {
        assert.equal(ir.idMapping[block.id], block.seqId);
      }
    });

    it('blocks have required properties', async () => {
      for (const block of ir.blocks) {
        assert.ok(block.id, 'Block should have id');
        assert.ok(block.seqId, 'Block should have seqId');
        assert.ok(block.type, 'Block should have type');
        assert.ok(typeof block.text === 'string', 'Block should have text');
        assert.ok(typeof block.startPos === 'number', 'Block should have startPos');
        assert.ok(typeof block.endPos === 'number', 'Block should have endPos');
      }
    });
  });

  describe('with asset-purchase.docx', () => {
    let ir;

    before(async () => {
      ir = await extractDocumentIR(path.join(fixturesDir, 'asset-purchase.docx'));
    });

    it('extracts a substantial number of blocks', async () => {
      // Asset purchase agreement should have many blocks
      assert.ok(ir.blocks.length > 50, `Expected >50 blocks, got ${ir.blocks.length}`);
    });

    it('detects headings', async () => {
      const headings = ir.blocks.filter(b => b.type === 'heading');
      assert.ok(headings.length > 0, 'Should detect at least one heading');
    });

    it('builds hierarchical outline', async () => {
      assert.ok(ir.outline, 'Should have outline');
      assert.ok(Array.isArray(ir.outline), 'Outline should be an array');
      // Contract should have multiple top-level sections
      if (ir.outline.length > 0) {
        const item = ir.outline[0];
        assert.ok(item.id, 'Outline item should have id');
        assert.ok(item.seqId, 'Outline item should have seqId');
        assert.ok(item.title, 'Outline item should have title');
        assert.ok(Array.isArray(item.children), 'Outline item should have children array');
      }
    });

    it('extracts defined terms', async () => {
      // Asset purchase agreement should have defined terms like "Business", "Assets", etc.
      if (ir.definedTerms && Object.keys(ir.definedTerms).length > 0) {
        const firstTerm = Object.keys(ir.definedTerms)[0];
        const termInfo = ir.definedTerms[firstTerm];
        assert.ok(termInfo.definedIn, 'Term should have definedIn block');
      }
    });

    it('detects clause numbers', async () => {
      const numberedBlocks = ir.blocks.filter(b => b.number);
      assert.ok(numberedBlocks.length > 0, 'Should detect some numbered clauses');
    });
  });

  describe('options', () => {
    it('respects maxTextLength option', async () => {
      const ir = await extractDocumentIR(
        path.join(fixturesDir, 'sample.docx'),
        { maxTextLength: 50 }
      );

      for (const block of ir.blocks) {
        // 50 chars + '...' = max 53
        assert.ok(block.text.length <= 53, `Block text should be truncated: ${block.text.length}`);
      }
    });

    it('can exclude outline with includeOutline: false', async () => {
      const ir = await extractDocumentIR(
        path.join(fixturesDir, 'sample.docx'),
        { includeOutline: false }
      );

      assert.equal(ir.outline, undefined, 'Should not have outline');
    });

    it('can exclude defined terms with includeDefinedTerms: false', async () => {
      const ir = await extractDocumentIR(
        path.join(fixturesDir, 'asset-purchase.docx'),
        { includeDefinedTerms: false }
      );

      assert.equal(ir.definedTerms, undefined, 'Should not have definedTerms');
    });

    it('sets format in metadata', async () => {
      const ir = await extractDocumentIR(
        path.join(fixturesDir, 'sample.docx'),
        { format: 'blocks' }
      );

      assert.equal(ir.metadata.format, 'blocks');
    });
  });

  describe('idMapping consistency', () => {
    it('every block id maps to its seqId', async () => {
      const ir = await extractDocumentIR(path.join(fixturesDir, 'sample.docx'));

      for (const block of ir.blocks) {
        assert.equal(
          ir.idMapping[block.id],
          block.seqId,
          `ID mapping mismatch for block ${block.seqId}`
        );
      }
    });

    it('idMapping contains exactly the blocks count', async () => {
      const ir = await extractDocumentIR(path.join(fixturesDir, 'sample.docx'));

      assert.equal(
        Object.keys(ir.idMapping).length,
        ir.blocks.length,
        'idMapping should have same count as blocks'
      );
    });
  });

  describe('block types', () => {
    it('correctly identifies block types', async () => {
      const ir = await extractDocumentIR(path.join(fixturesDir, 'asset-purchase.docx'));

      const types = new Set(ir.blocks.map(b => b.type));
      // Should have at least paragraphs
      assert.ok(types.has('paragraph'), 'Should have paragraph blocks');
    });
  });

  describe('error handling', () => {
    it('throws for non-existent file', async () => {
      await assert.rejects(
        extractDocumentIR('/nonexistent/file.docx'),
        { code: 'ENOENT' }
      );
    });
  });
});
