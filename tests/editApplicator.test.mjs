/**
 * Tests for Edit Applicator - Validation and Edit Application
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createEditorWithIR, extractDocumentIR } from '../src/irExtractor.mjs';
import {
  applyEdits,
  validateEdits,
  validateEditsAgainstIR,
  validateNewText,
  sortEditsForApplication,
  loadDocumentForEditing,
  exportDocument
} from '../src/editApplicator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const outputDir = path.join(__dirname, 'output');
const sampleDocx = path.join(fixturesDir, 'sample.docx');
const assetPurchaseDocx = path.join(fixturesDir, 'asset-purchase.docx');

// Ensure output directory exists
before(async () => {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }
});

describe('validateEditsAgainstIR', () => {
  it('validates edits with valid block IDs', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: ir.blocks[0].id, operation: 'replace', newText: 'test' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
    assert.equal(result.summary.totalEdits, 1);
    assert.equal(result.summary.validEdits, 1);
    assert.equal(result.summary.invalidEdits, 0);

    cleanup();
  });

  it('validates edits with seqId format', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'test' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);

    cleanup();
  });

  it('rejects edits with missing block IDs', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: 'b999', operation: 'replace', newText: 'test' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].type, 'missing_block');
    assert.equal(result.issues[0].editIndex, 0);
    assert.equal(result.issues[0].blockId, 'b999');

    cleanup();
  });

  it('rejects replace without newText', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: ir.blocks[0].id, operation: 'replace' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, 'missing_field');
    assert.ok(result.issues[0].message.includes('newText'));

    cleanup();
  });

  it('rejects comment without comment field', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: ir.blocks[0].id, operation: 'comment' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, 'missing_field');
    assert.ok(result.issues[0].message.includes('comment'));

    cleanup();
  });

  it('rejects insert without text field', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { afterBlockId: ir.blocks[0].id, operation: 'insert' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, 'missing_field');
    assert.ok(result.issues[0].message.includes('text'));

    cleanup();
  });

  it('rejects unknown operations', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: ir.blocks[0].id, operation: 'unknown' }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, 'invalid_operation');

    cleanup();
  });

  it('reports multiple validation issues', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: 'b999', operation: 'replace', newText: 'test' },  // Invalid block
      { blockId: ir.blocks[0].id, operation: 'replace' },          // Missing newText
      { blockId: ir.blocks[0].id, operation: 'delete' }            // Valid
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.equal(result.issues.length, 2);
    assert.equal(result.summary.totalEdits, 3);
    assert.equal(result.summary.validEdits, 1);
    assert.equal(result.summary.invalidEdits, 2);

    cleanup();
  });
});

describe('validateEdits', () => {
  it('validates edits against document file using seqId', async () => {
    // Use seqId which is stable across editor sessions
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'test' }
      ]
    };

    const result = await validateEdits(sampleDocx, editConfig);

    assert.equal(result.valid, true);
  });
});

describe('sortEditsForApplication', () => {
  it('sorts edits by position descending', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    // Create edits for blocks at different positions
    const firstBlock = ir.blocks[0];
    const lastBlock = ir.blocks[ir.blocks.length - 1];
    const middleBlock = ir.blocks[Math.floor(ir.blocks.length / 2)];

    const edits = [
      { blockId: firstBlock.id, operation: 'replace', newText: 'first' },
      { blockId: lastBlock.id, operation: 'replace', newText: 'last' },
      { blockId: middleBlock.id, operation: 'replace', newText: 'middle' }
    ];

    const sorted = sortEditsForApplication(edits, ir);

    // Verify highest position is first
    const positionMap = new Map(ir.blocks.map(b => [b.id, b.startPos]));
    const sortedPositions = sorted.map(e => positionMap.get(e.blockId));

    for (let i = 1; i < sortedPositions.length; i++) {
      assert.ok(
        sortedPositions[i - 1] >= sortedPositions[i],
        `Position at ${i - 1} (${sortedPositions[i - 1]}) should be >= position at ${i} (${sortedPositions[i]})`
      );
    }

    cleanup();
  });

  it('handles edits with seqId format', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { blockId: ir.blocks[0].seqId, operation: 'replace', newText: 'first' },
      { blockId: ir.blocks[ir.blocks.length - 1].seqId, operation: 'replace', newText: 'last' }
    ];

    const sorted = sortEditsForApplication(edits, ir);

    // Should not throw and should return sorted array
    assert.equal(sorted.length, 2);

    cleanup();
  });

  it('handles insert operations with afterBlockId', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      { afterBlockId: ir.blocks[0].id, operation: 'insert', text: 'new' },
      { afterBlockId: ir.blocks[ir.blocks.length - 1].id, operation: 'insert', text: 'another' }
    ];

    const sorted = sortEditsForApplication(edits, ir);

    assert.equal(sorted.length, 2);
    // Last block should be first after sorting
    assert.equal(sorted[0].afterBlockId, ir.blocks[ir.blocks.length - 1].id);

    cleanup();
  });
});

describe('applyEdits', () => {
  it('applies single replace edit', async () => {
    // Use seqId which is stable across editor sessions
    const outputPath = path.join(outputDir, 'single-replace-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'Modified content' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.applied, 1);
    assert.equal(result.skipped.length, 0);

    // Verify file was created
    const outputBuffer = await readFile(outputPath);
    assert.ok(outputBuffer.length > 0);
    // DOCX files start with PK (ZIP signature)
    assert.equal(outputBuffer[0], 0x50);
    assert.equal(outputBuffer[1], 0x4b);
  });

  it('applies single delete edit', async () => {
    const outputPath = path.join(outputDir, 'single-delete-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'delete' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.applied, 1);
  });

  it('applies single comment edit', async () => {
    const outputPath = path.join(outputDir, 'single-comment-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'comment', comment: 'This needs review' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.applied, 1);
    assert.ok(result.details[0].commentId);
  });

  it('applies single insert edit', async () => {
    const outputPath = path.join(outputDir, 'single-insert-test.docx');
    const editConfig = {
      edits: [
        { afterBlockId: 'b001', operation: 'insert', text: 'New paragraph here' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.applied, 1);
    assert.ok(result.details[0].newBlockId);
  });

  it('applies multiple edits in correct order', async () => {
    // Use asset-purchase.docx which has many blocks
    const outputPath = path.join(outputDir, 'multi-edit-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'First modified' },
        { blockId: 'b005', operation: 'replace', newText: 'Fifth modified' }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.applied, 2);
  });

  it('skips invalid edits but applies valid ones', async () => {
    const outputPath = path.join(outputDir, 'partial-edit-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'Valid edit' },
        { blockId: 'b999', operation: 'replace', newText: 'Invalid - block not found' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, false); // Not all edits applied
    assert.equal(result.applied, 1);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0].reason.includes('not found'));
  });

  it('exports valid DOCX file', async () => {
    const outputPath = path.join(outputDir, 'export-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'comment', comment: 'Test comment' }
      ]
    };

    await applyEdits(sampleDocx, outputPath, editConfig);

    // Verify file exists and is valid DOCX
    const buffer = await readFile(outputPath);
    assert.ok(buffer.length > 0);
    // DOCX files start with PK (ZIP signature)
    assert.equal(buffer[0], 0x50);
    assert.equal(buffer[1], 0x4b);
  });

  it('respects author option', async () => {
    const outputPath = path.join(outputDir, 'author-test.docx');
    const editConfig = {
      author: { name: 'Custom Author', email: 'custom@example.com' },
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'Author test' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
  });

  it('can disable validation', async () => {
    const outputPath = path.join(outputDir, 'no-validation-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'No validation' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig, {
      validateFirst: false
    });

    assert.equal(result.applied, 1);
  });

  it('can disable sort', async () => {
    const outputPath = path.join(outputDir, 'no-sort-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'replace', newText: 'No sort' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig, {
      sortEdits: false
    });

    assert.equal(result.applied, 1);
  });
});

describe('loadDocumentForEditing', () => {
  it('returns editor and IR with consistent IDs', async () => {
    const { editor, ir, cleanup } = await loadDocumentForEditing(sampleDocx);

    assert.ok(editor);
    assert.ok(ir);
    assert.ok(ir.blocks.length > 0);

    // Verify IDs are consistent
    const firstBlockId = ir.blocks[0].id;
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.attrs.sdBlockId === firstBlockId) {
        found = true;
        return false;
      }
      return true;
    });

    assert.ok(found, 'Block ID from IR should exist in editor');

    cleanup();
  });

  it('respects trackChanges option', async () => {
    const { editor, cleanup } = await loadDocumentForEditing(sampleDocx, {
      trackChanges: true
    });

    // Editor should be in suggesting mode
    assert.ok(editor);

    cleanup();
  });
});

describe('integration scenarios', () => {
  it('applies mixed operations on larger document', async () => {
    const outputPath = path.join(outputDir, 'mixed-operations-test.docx');

    // Use seqIds that should exist in asset-purchase.docx
    const editConfig = {
      edits: [
        {
          blockId: 'b001',
          operation: 'replace',
          newText: 'MODIFIED: Asset Purchase Agreement'
        },
        {
          blockId: 'b005',
          operation: 'comment',
          comment: 'Review this clause'
        },
        {
          afterBlockId: 'b010',
          operation: 'insert',
          text: 'NEW CLAUSE: Additional terms and conditions apply.',
          type: 'paragraph'
        }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    assert.equal(result.applied, 3);
    assert.equal(result.skipped.length, 0);
  });

  it('handles edits with comments attached', async () => {
    const outputPath = path.join(outputDir, 'edit-with-comment-test.docx');
    const editConfig = {
      edits: [
        {
          blockId: 'b001',
          operation: 'replace',
          newText: 'Replaced with comment',
          comment: 'Explaining the change'
        }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.comments.length, 1);
    assert.ok(result.comments[0].text.includes('Explaining'));
  });

  it('applies edit config version 0.2.0 format', async () => {
    const outputPath = path.join(outputDir, 'versioned-config-test.docx');
    const editConfig = {
      version: '0.2.0',
      author: {
        name: 'AI Counsel',
        email: 'ai@firm.com'
      },
      edits: [
        {
          blockId: 'b001',
          operation: 'replace',
          newText: 'Versioned edit',
          diff: true
        }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.ok(result.details[0].diffStats);
  });
});

describe('error handling', () => {
  it('handles non-existent input file', async () => {
    const editConfig = {
      edits: [
        { blockId: 'any', operation: 'replace', newText: 'test' }
      ]
    };

    await assert.rejects(
      async () => applyEdits('/non/existent/file.docx', '/tmp/output.docx', editConfig),
      /ENOENT|no such file/i
    );
  });

  it('handles empty edits array', async () => {
    const outputPath = path.join(outputDir, 'empty-edits-test.docx');
    const editConfig = { edits: [] };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, true);
    assert.equal(result.applied, 0);
    assert.equal(result.skipped.length, 0);
  });

  it('handles unknown operation gracefully', async () => {
    const outputPath = path.join(outputDir, 'unknown-op-test.docx');
    const editConfig = {
      edits: [
        { blockId: 'b001', operation: 'unknown_operation' }
      ]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.success, false);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0].reason.includes('invalid_operation') || result.skipped[0].reason.includes('Unknown'));
  });
});

describe('validateNewText', () => {
  it('returns valid for normal text changes', () => {
    const original = 'The Purchase Price is the sum of £500.';
    const newText = 'The Purchase Price is the sum of S$500.';

    const result = validateNewText(original, newText);

    assert.equal(result.valid, true);
    assert.equal(result.severity, 'ok');
    assert.equal(result.warnings.length, 0);
  });

  it('detects significant truncation', () => {
    const original = 'The Purchase Price is the sum of £500, which shall be paid by the Buyer to the Seller in cash on Completion in accordance with clause 4.3.';
    const newText = 'The Purchase Price is the sum of S$500';

    const result = validateNewText(original, newText);

    assert.equal(result.severity, 'warning');
    assert.ok(result.warnings.some(w => w.includes('reduction') || w.includes('truncation')));
  });

  it('detects ellipsis truncation pattern', () => {
    const original = 'Full sentence here.';
    const newText = 'Full sentence here...';

    const result = validateNewText(original, newText);

    assert.equal(result.valid, false);
    assert.equal(result.severity, 'error');
    assert.ok(result.warnings.some(w => w.includes('ellipsis')));
  });

  it('detects trailing comma truncation', () => {
    const original = 'Complete text.';
    const newText = 'Complete text,';

    const result = validateNewText(original, newText);

    assert.equal(result.valid, false);
    assert.equal(result.severity, 'error');
    assert.ok(result.warnings.some(w => w.includes('comma')));
  });

  it('detects garbled content pattern (4.3S$)', () => {
    const original = 'The sum of £500, clause 4.3.';
    const newText = 'The sum of 4.3S$500';

    const result = validateNewText(original, newText);

    assert.equal(result.valid, false);
    assert.equal(result.severity, 'error');
    assert.ok(result.warnings.some(w => w.includes('corruption') || w.includes('Suspicious')));
  });

  it('allows empty newText for deletions', () => {
    const original = 'Some text to delete.';
    const newText = '';

    const result = validateNewText(original, newText);

    assert.equal(result.valid, true);
    assert.equal(result.severity, 'ok');
  });

  it('does not flag short text changes', () => {
    const original = 'Short';
    const newText = 'S';

    const result = validateNewText(original, newText);

    // Short text shouldn't trigger truncation warnings
    assert.equal(result.valid, true);
  });

  it('allows legitimate pattern that looks like truncation', () => {
    // Some valid text might end with numbers that look suspicious
    const original = 'Version 1.0';
    const newText = 'Version 2.0';

    const result = validateNewText(original, newText);

    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 0);
  });
});
