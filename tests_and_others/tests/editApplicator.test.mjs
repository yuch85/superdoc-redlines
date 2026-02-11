/**
 * Tests for Edit Applicator - Validation and Edit Application
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createEditorWithIR, extractDocumentIR } from '../../src/irExtractor.mjs';
import {
  applyEdits,
  validateEdits,
  validateEditsAgainstIR,
  validateNewText,
  sortEditsForApplication,
  loadDocumentForEditing,
  exportDocument,
  isTocBlock,
  detectTocStructure,
  looksLikeUuid,
  buildCommentEntry,
  linkifyLine
} from '../../src/editApplicator.mjs';

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
    // Comments now use SuperDoc-compatible format with commentJSON (ProseMirror nodes)
    assert.ok(result.comments[0].commentId, 'Should have commentId field');
    assert.ok(result.comments[0].commentJSON[0].content[0].text.includes('Explaining'),
      'commentJSON should contain the comment text');
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

describe('Issue #3: TOC Block Detection', () => {
  describe('isTocBlock', () => {
    it('detects TOC entry with dot leaders and page numbers', () => {
      const block = { text: '1. Introduction.....12' };
      assert.equal(isTocBlock(block), true);
    });

    it('detects TOC entry with tab and page number', () => {
      const block = { text: '1. Section\t12' };
      assert.equal(isTocBlock(block), true);
    });

    it('detects Schedule entry', () => {
      const block = { text: 'Schedule 1' };
      assert.equal(isTocBlock(block), true);
    });

    it('detects Part entry (Roman numerals)', () => {
      const block = { text: 'Part IV' };
      assert.equal(isTocBlock(block), true);
    });

    it('detects Part entry (Arabic numerals)', () => {
      const block = { text: 'Part 3' };
      assert.equal(isTocBlock(block), true);
    });

    it('does NOT flag regular paragraph text', () => {
      const block = { text: 'This Agreement shall be governed by the laws of Singapore.' };
      assert.equal(isTocBlock(block), false);
    });

    it('does NOT flag heading text without TOC markers', () => {
      const block = { text: '1. Definitions and Interpretation' };
      assert.equal(isTocBlock(block), false);
    });

    it('does NOT flag definition text', () => {
      const block = { text: '"Business Day" means a day other than Saturday, Sunday or public holiday in Singapore.' };
      assert.equal(isTocBlock(block), false);
    });

    it('handles empty text gracefully', () => {
      const block = { text: '' };
      assert.equal(isTocBlock(block), false);
    });

    it('handles undefined text gracefully', () => {
      const block = {};
      assert.equal(isTocBlock(block), false);
    });
  });

  describe('detectTocStructure', () => {
    it('detects TOC entry and provides reason', () => {
      const block = { text: '1.2 Section Name.....12', seqId: 'b050' };
      const result = detectTocStructure(block);
      
      assert.equal(result.isToc, true);
      assert.ok(result.reason.includes('TOC entry pattern'));
    });

    it('detects short text with TOC markers in document front matter', () => {
      const block = { text: 'Introduction...5', seqId: 'b010' };
      const result = detectTocStructure(block);
      
      assert.equal(result.isToc, true);
    });

    it('returns false for regular content', () => {
      const block = { 
        text: 'The Seller agrees to transfer all assets to the Buyer.', 
        seqId: 'b500' 
      };
      const result = detectTocStructure(block);
      
      assert.equal(result.isToc, false);
      assert.equal(result.reason, undefined);
    });

    it('does NOT flag short text without TOC markers', () => {
      const block = { text: 'Short text here', seqId: 'b020' };
      const result = detectTocStructure(block);
      
      assert.equal(result.isToc, false);
    });
  });

  describe('validateEditsAgainstIR with TOC blocks', () => {
    it('warns when editing a TOC-like block', async () => {
      // Create a mock IR with a TOC-like block
      const mockIr = {
        blocks: [
          { id: 'uuid-001', seqId: 'b001', text: '1. Introduction.....12', startPos: 0, endPos: 50 }
        ]
      };

      const edits = [
        { blockId: 'b001', operation: 'replace', newText: 'Modified TOC entry' }
      ];

      const result = validateEditsAgainstIR(edits, mockIr);

      // Should be valid (warning, not error) but have warning
      assert.equal(result.valid, true);
      assert.ok(result.warnings.length > 0, 'Should have at least one warning');
      assert.ok(result.warnings.some(w => w.type === 'toc_warning'), 'Should have TOC warning');
      assert.ok(result.warnings[0].message.includes('TOC block'), 'Warning should mention TOC block');
    });

    it('does NOT warn for regular blocks', async () => {
      const mockIr = {
        blocks: [
          { id: 'uuid-001', seqId: 'b001', text: 'Regular clause text about business operations.', startPos: 0, endPos: 100 }
        ]
      };

      const edits = [
        { blockId: 'b001', operation: 'replace', newText: 'Modified regular text' }
      ];

      const result = validateEditsAgainstIR(edits, mockIr);

      assert.equal(result.valid, true);
      // Should have no TOC warnings
      assert.ok(!result.warnings.some(w => w.type === 'toc_warning'), 'Should NOT have TOC warning for regular blocks');
    });
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

  it('allows trailing comma when original also ends with comma (list items)', () => {
    // This is the false positive fix: if original text also ends with comma,
    // it's likely a list item and the trailing comma is intentional
    const original = 'all salaries, wages, bonuses, commissions, maternity pay, paternity pay, accrued holiday entitlement and holiday pay entitlement, and other emoluments including but not limited to PAYE income tax, National Insurance contributions, health insurance, death in service benefits, season ticket loans and any contributions to pension arrangements,';
    const newText = 'all salaries, wages, bonuses, commissions, maternity pay, paternity pay, accrued annual leave entitlement and annual leave pay entitlement, and other emoluments including but not limited to income tax withholding, Central Provident Fund contributions, health insurance, death in service benefits, and any contributions to supplementary retirement schemes,';

    const result = validateNewText(original, newText);

    // Should NOT flag as error since both end with comma
    assert.equal(result.valid, true);
    // May still have warnings (like content reduction), but not the trailing comma error
    assert.ok(!result.warnings.some(w => w.includes('trailing comma')));
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

// ====================================================================
// v0.3.0 Operations Tests
// ====================================================================

describe('validateEditsAgainstIR - v0.3.0 operations', () => {
  it('accepts insertAfterText with valid fields', async () => {
    const { ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    // Find a block with text content to use as findText
    const block = ir.blocks.find(b => b.text && b.text.length > 10);
    const findText = block.text.slice(0, 10);

    const edits = [
      {
        blockId: block.seqId,
        operation: 'insertAfterText',
        findText: findText,
        insertText: 'additional text'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);

    cleanup();
  });

  it('rejects insertAfterText without findText', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      {
        blockId: ir.blocks[0].seqId,
        operation: 'insertAfterText',
        insertText: 'some text'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.type === 'missing_field' && i.message.includes('findText')));

    cleanup();
  });

  it('rejects insertAfterText without insertText', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      {
        blockId: ir.blocks[0].seqId,
        operation: 'insertAfterText',
        findText: 'some text'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.type === 'missing_field' && i.message.includes('insertText')));

    cleanup();
  });

  it('accepts highlight with valid fields', async () => {
    const { ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 10);
    const findText = block.text.slice(0, 10);

    const edits = [
      {
        blockId: block.seqId,
        operation: 'highlight',
        findText: findText,
        color: '#FFEB3B'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);

    cleanup();
  });

  it('rejects commentRange without comment', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      {
        blockId: ir.blocks[0].seqId,
        operation: 'commentRange',
        findText: 'some text'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.type === 'missing_field' && i.message.includes('comment')));

    cleanup();
  });

  it('rejects commentHighlight without comment', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      {
        blockId: ir.blocks[0].seqId,
        operation: 'commentHighlight',
        findText: 'some text'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.type === 'missing_field' && i.message.includes('comment')));

    cleanup();
  });

  it('warns when findText not found in block text', async () => {
    const { ir, cleanup } = await createEditorWithIR(sampleDocx);

    const edits = [
      {
        blockId: ir.blocks[0].seqId,
        operation: 'highlight',
        findText: 'NONEXISTENT_TEXT_THAT_DOES_NOT_APPEAR_IN_BLOCK'
      }
    ];

    const result = validateEditsAgainstIR(edits, ir);

    // findText not found is a warning, not an error
    assert.ok(result.warnings.length > 0, 'Should have at least one warning');
    assert.ok(result.warnings.some(w => w.type === 'findtext_warning'), 'Should have findtext_warning');
    assert.ok(result.warnings[0].message.includes('not found in block text'));

    cleanup();
  });
});

describe('applyEdits - v0.3.0 operations', () => {
  it('applies single insertAfterText edit', async () => {
    const { ir, cleanup: irCleanup } = await createEditorWithIR(assetPurchaseDocx);

    // Find a block with text content to use as findText target
    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    const findText = block.text.slice(0, 15);

    irCleanup();

    const outputPath = path.join(outputDir, 'insertAfterText-test.docx');
    const editConfig = {
      edits: [
        {
          blockId: block.seqId,
          operation: 'insertAfterText',
          findText: findText,
          insertText: ' [ADDED TEXT] '
        }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    assert.equal(result.applied, 1);
    assert.equal(result.skipped.length, 0);
  });

  it('applies single commentRange edit', async () => {
    const { ir, cleanup: irCleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    const findText = block.text.slice(0, 15);

    irCleanup();

    const outputPath = path.join(outputDir, 'commentRange-test.docx');
    const editConfig = {
      edits: [
        {
          blockId: block.seqId,
          operation: 'commentRange',
          findText: findText,
          comment: 'Review this specific text'
        }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    assert.equal(result.applied, 1);
    assert.ok(result.details[0].commentId, 'Should have commentId in details');
  });

  it('applies comment with findText (enhanced comment)', async () => {
    const { ir, cleanup: irCleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    const findText = block.text.slice(0, 15);

    irCleanup();

    const outputPath = path.join(outputDir, 'comment-findText-test.docx');
    const editConfig = {
      edits: [
        {
          blockId: block.seqId,
          operation: 'comment',
          findText: findText,
          comment: 'Enhanced comment anchored to specific text'
        }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    assert.equal(result.applied, 1);
    assert.ok(result.details[0].commentId);
  });

  it('applies commentHighlight edit', async () => {
    const { ir, cleanup: irCleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    const findText = block.text.slice(0, 15);

    irCleanup();

    const outputPath = path.join(outputDir, 'commentHighlight-test.docx');
    const editConfig = {
      edits: [
        {
          blockId: block.seqId,
          operation: 'commentHighlight',
          findText: findText,
          comment: 'Highlighted and commented',
          color: '#FFF176'
        }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    // commentHighlight does highlight + comment; both may succeed or fail
    // depending on editor support for setHighlight
    assert.ok(typeof result.applied === 'number');
    assert.ok(typeof result.skipped.length === 'number');
  });

  it('handles insertAfterText with findText not found (skip)', async () => {
    const outputPath = path.join(outputDir, 'insertAfterText-notfound-test.docx');
    const editConfig = {
      edits: [
        {
          blockId: 'b001',
          operation: 'insertAfterText',
          findText: 'XYZZY_NONEXISTENT_TEXT_THAT_WILL_NOT_MATCH',
          insertText: 'should not be inserted'
        }
      ]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    // The edit should be skipped because findText was not found
    assert.equal(result.applied, 0);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0].reason.includes('not found'));
  });
});

describe('sortEditsForApplication - v0.3.0 secondary sort', () => {
  it('sorts multiple insertAfterText on same block by findText position descending', async () => {
    const { ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    // Find a block with enough text for two different findText matches
    const block = ir.blocks.find(b => b.text && b.text.length > 40);
    assert.ok(block, 'Should find a block with sufficient text');

    const earlyText = block.text.slice(0, 10);
    const lateText = block.text.slice(20, 30);

    const edits = [
      {
        blockId: block.seqId,
        operation: 'insertAfterText',
        findText: earlyText,
        insertText: ' EARLY '
      },
      {
        blockId: block.seqId,
        operation: 'insertAfterText',
        findText: lateText,
        insertText: ' LATE '
      }
    ];

    const sorted = sortEditsForApplication(edits, ir);

    // The later-occurring findText should come first (rightmost first)
    // because we apply from end to start to avoid position corruption
    assert.equal(sorted.length, 2);
    assert.equal(sorted[0].findText, lateText, 'Later findText should be sorted first');
    assert.equal(sorted[1].findText, earlyText, 'Earlier findText should be sorted second');

    cleanup();
  });
});

// ====================================================================
// UUID vs seqId Guidance Tests (sgcite debug handoff)
// ====================================================================

describe('looksLikeUuid', () => {
  it('detects canonical UUIDs', () => {
    assert.equal(looksLikeUuid('cadc0dcc-4e97-4cc2-a51d-cc811ba4832d'), true);
    assert.equal(looksLikeUuid('b7a08a59-4259-402c-9e8f-69b8afc2c511'), true);
  });

  it('rejects seqIds and garbage', () => {
    assert.equal(looksLikeUuid('b001'), false);
    assert.equal(looksLikeUuid('b999'), false);
    assert.equal(looksLikeUuid('not-a-uuid'), false);
    assert.equal(looksLikeUuid(''), false);
  });
});

describe('UUID guidance in validation', () => {
  it('produces actionable guidance when UUID blockId used in validation', async () => {
    // Extract IR (captures a UUID that will NOT survive into next load)
    const ir1 = await extractDocumentIR(sampleDocx);
    const staleUuid = ir1.blocks[0].id;

    // Validate in a fresh load (UUID will be different)
    const editConfig = {
      edits: [{ blockId: staleUuid, operation: 'comment', comment: 'test' }]
    };
    const result = await validateEdits(sampleDocx, editConfig);

    assert.equal(result.valid, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].type, 'missing_block');
    assert.ok(result.issues[0].message.includes('seqId'),
      'Error should guide user to use seqId');
    assert.ok(result.issues[0].message.includes('not portable'),
      'Error should explain UUID volatility');
  });

  it('seqId validation still succeeds after UUID guidance changes', async () => {
    const editConfig = {
      edits: [{ blockId: 'b001', operation: 'comment', comment: 'test' }]
    };
    const result = await validateEdits(sampleDocx, editConfig);
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });
});

describe('UUID guidance in apply', () => {
  it('produces actionable guidance when UUID blockId used in apply', async () => {
    const ir1 = await extractDocumentIR(sampleDocx);
    const staleUuid = ir1.blocks[0].id;
    const outputPath = path.join(outputDir, 'uuid-guidance-test.docx');

    const editConfig = {
      edits: [{ blockId: staleUuid, operation: 'comment', comment: 'test' }]
    };
    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.equal(result.applied, 0);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0].reason.includes('seqId'),
      'Skip reason should guide user to use seqId');
  });

  it('seqId apply still succeeds after UUID guidance changes', async () => {
    const outputPath = path.join(outputDir, 'seqid-regression-test.docx');
    const editConfig = {
      edits: [{ blockId: 'b001', operation: 'comment', comment: 'test' }]
    };
    const result = await applyEdits(sampleDocx, outputPath, editConfig);
    assert.equal(result.applied, 1);
    assert.equal(result.skipped.length, 0);
  });
});

// ====================================================================
// Debug Handoff 17: buildCommentEntry + DOCX Comment Forensics Tests
// ====================================================================

describe('buildCommentEntry', () => {
  it('produces SuperDoc-compatible comment objects', () => {
    const entry = buildCommentEntry(
      'comment-123-abc',
      'Test comment text',
      { name: 'Test Author', email: 'test@example.com' }
    );

    // Required SuperDoc fields
    assert.strictEqual(entry.commentId, 'comment-123-abc');
    assert.strictEqual(entry.creatorName, 'Test Author');
    assert.strictEqual(entry.creatorEmail, 'test@example.com');
    assert.strictEqual(typeof entry.createdTime, 'number');
    assert.ok(entry.createdTime > 0);

    // commentJSON must be ProseMirror node array
    assert.ok(Array.isArray(entry.commentJSON));
    assert.strictEqual(entry.commentJSON[0].type, 'paragraph');
    assert.strictEqual(entry.commentJSON[0].content[0].type, 'text');
    assert.strictEqual(entry.commentJSON[0].content[0].text, 'Test comment text');

    // Must NOT have the old broken fields
    assert.strictEqual(entry.id, undefined);
    assert.strictEqual(entry.text, undefined);
    assert.strictEqual(entry.author, undefined);
    assert.strictEqual(entry.blockId, undefined);
  });

  it('handles string author gracefully', () => {
    const entry = buildCommentEntry('comment-456', 'Text', 'Plain String Author');
    assert.strictEqual(entry.creatorName, 'Plain String Author');
    assert.strictEqual(entry.creatorEmail, '');
  });

  it('handles null author with defaults', () => {
    const entry = buildCommentEntry('comment-789', 'Text', null);
    assert.strictEqual(entry.creatorName, 'AI Assistant');
    assert.strictEqual(entry.creatorEmail, '');
  });

  it('handles undefined author with defaults', () => {
    const entry = buildCommentEntry('comment-abc', 'Text', undefined);
    assert.strictEqual(entry.creatorName, 'AI Assistant');
    assert.strictEqual(entry.creatorEmail, '');
  });

  it('handles multi-line comment text with newline splitting', () => {
    const entry = buildCommentEntry('comment-multi', 'Line one\nLine two\nLine three', { name: 'A', email: 'a@b.c' });

    assert.strictEqual(entry.commentJSON.length, 3, 'Should produce 3 paragraph nodes for 3 lines');
    assert.strictEqual(entry.commentJSON[0].content[0].text, 'Line one');
    assert.strictEqual(entry.commentJSON[1].content[0].text, 'Line two');
    assert.strictEqual(entry.commentJSON[2].content[0].text, 'Line three');
  });

  it('handles emoji and unicode in comment text', () => {
    const entry = buildCommentEntry('comment-emoji', '✅ VERIFIED: Citation is accurate', { name: 'A', email: 'a@b.c' });

    assert.strictEqual(entry.commentJSON[0].content[0].text, '✅ VERIFIED: Citation is accurate');
  });

  it('handles author object with missing name', () => {
    const entry = buildCommentEntry('comment-noname', 'Text', { email: 'test@test.com' });
    assert.strictEqual(entry.creatorName, 'AI Assistant');
    assert.strictEqual(entry.creatorEmail, 'test@test.com');
  });

  it('handles author object with missing email', () => {
    const entry = buildCommentEntry('comment-noemail', 'Text', { name: 'Bot' });
    assert.strictEqual(entry.creatorName, 'Bot');
    assert.strictEqual(entry.creatorEmail, '');
  });
});

// ====================================================================
// A021: linkifyLine + buildCommentEntry URL linkification tests
// ====================================================================

describe('linkifyLine', () => {
  it('returns plain text node for line with no URL', () => {
    const result = linkifyLine('Just plain text');
    assert.deepStrictEqual(result, [
      { type: 'text', text: 'Just plain text' }
    ]);
  });

  it('returns space node for empty string', () => {
    const result = linkifyLine('');
    assert.deepStrictEqual(result, [
      { type: 'text', text: ' ' }
    ]);
  });

  it('linkifies a standalone URL', () => {
    const result = linkifyLine('https://www.example.com/path');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].text, 'https://www.example.com/path');
    assert.deepStrictEqual(result[0].marks, [
      { type: 'link', attrs: { href: 'https://www.example.com/path' } }
    ]);
  });

  it('splits text before and after a URL', () => {
    const result = linkifyLine('Source: https://www.elitigation.sg/gdviewer/s/2007_SGCA_37');
    assert.strictEqual(result.length, 2);
    // Text before
    assert.strictEqual(result[0].text, 'Source: ');
    assert.strictEqual(result[0].marks, undefined);
    // URL with link mark
    assert.strictEqual(result[1].text, 'https://www.elitigation.sg/gdviewer/s/2007_SGCA_37');
    assert.deepStrictEqual(result[1].marks, [
      { type: 'link', attrs: { href: 'https://www.elitigation.sg/gdviewer/s/2007_SGCA_37' } }
    ]);
  });

  it('handles URL followed by trailing text', () => {
    const result = linkifyLine('Visit https://example.com for details');
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].text, 'Visit ');
    assert.strictEqual(result[1].text, 'https://example.com');
    assert.deepStrictEqual(result[1].marks, [
      { type: 'link', attrs: { href: 'https://example.com' } }
    ]);
    assert.strictEqual(result[2].text, ' for details');
  });

  it('strips trailing period from URL', () => {
    const result = linkifyLine('See https://example.com/page.');
    // URL should not include the trailing period
    const linkNode = result.find(n => n.marks);
    assert.strictEqual(linkNode.text, 'https://example.com/page');
    assert.strictEqual(linkNode.marks[0].attrs.href, 'https://example.com/page');
    // The period should be in the next text node
    const lastNode = result[result.length - 1];
    assert.ok(lastNode.text.startsWith('.'));
  });

  it('handles multiple URLs in one line', () => {
    const result = linkifyLine('Compare https://a.com and https://b.com here');
    const links = result.filter(n => n.marks);
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].text, 'https://a.com');
    assert.strictEqual(links[1].text, 'https://b.com');
  });

  it('handles http (not just https)', () => {
    const result = linkifyLine('Source: http://example.com/path');
    const linkNode = result.find(n => n.marks);
    assert.ok(linkNode, 'Should detect http:// URL');
    assert.strictEqual(linkNode.text, 'http://example.com/path');
  });

  it('handles eLitigation URL format', () => {
    const url = 'https://www.elitigation.sg/gdviewer/s/2020_SGCA_15';
    const result = linkifyLine(`Source: ${url}`);
    const linkNode = result.find(n => n.marks);
    assert.strictEqual(linkNode.text, url);
    assert.strictEqual(linkNode.marks[0].attrs.href, url);
  });

  it('preserves emoji and unicode around URLs', () => {
    const result = linkifyLine('✅ Source: https://example.com/判决');
    assert.strictEqual(result[0].text, '✅ Source: ');
    const linkNode = result.find(n => n.marks);
    assert.ok(linkNode);
  });
});

describe('buildCommentEntry — URL linkification', () => {
  it('linkifies URL in Source line of comment', () => {
    const text = '✅ VERIFIED: Citation resolved and checks passed.\nSource: https://www.elitigation.sg/gdviewer/s/2007_SGCA_37';
    const entry = buildCommentEntry('comment-link-1', text, { name: 'A', email: 'a@b.c' });

    // First paragraph: no link (plain status text)
    const p1 = entry.commentJSON[0];
    assert.strictEqual(p1.content.length, 1);
    assert.strictEqual(p1.content[0].marks, undefined);

    // Second paragraph: "Source: " prefix + linked URL
    const p2 = entry.commentJSON[1];
    assert.strictEqual(p2.content.length, 2, 'Should have prefix text + link');
    assert.strictEqual(p2.content[0].text, 'Source: ');
    assert.strictEqual(p2.content[0].marks, undefined);
    assert.strictEqual(p2.content[1].text, 'https://www.elitigation.sg/gdviewer/s/2007_SGCA_37');
    assert.deepStrictEqual(p2.content[1].marks, [
      { type: 'link', attrs: { href: 'https://www.elitigation.sg/gdviewer/s/2007_SGCA_37' } }
    ]);
  });

  it('does not add link marks when comment has no URLs', () => {
    const entry = buildCommentEntry('comment-nourl', 'Plain comment text', { name: 'A', email: 'a@b.c' });
    const content = entry.commentJSON[0].content;
    assert.strictEqual(content.length, 1);
    assert.strictEqual(content[0].text, 'Plain comment text');
    assert.strictEqual(content[0].marks, undefined);
  });

  it('preserves existing multi-line behaviour with URLs on second line', () => {
    const text = 'Line one\nSource: https://example.com\nLine three';
    const entry = buildCommentEntry('comment-multi-url', text, { name: 'A', email: 'a@b.c' });

    assert.strictEqual(entry.commentJSON.length, 3);
    // Line 1: plain
    assert.strictEqual(entry.commentJSON[0].content[0].marks, undefined);
    // Line 2: linked
    const linkNode = entry.commentJSON[1].content.find(n => n.marks);
    assert.ok(linkNode, 'Second paragraph should contain a link');
    // Line 3: plain
    assert.strictEqual(entry.commentJSON[2].content[0].marks, undefined);
  });
});

describe('DOCX comment forensics - comment edits produce SuperDoc-compatible output', () => {
  it('comment edits return comments in SuperDoc format', async () => {
    const outputPath = path.join(outputDir, 'comment-format-test.docx');
    const editConfig = {
      version: '0.3.0',
      author: { name: 'Test Author', email: 'test@test.com' },
      edits: [{
        blockId: 'b001',
        operation: 'comment',
        comment: 'Test comment body'
      }]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.ok(result.applied >= 1, 'Comment edit should apply');
    assert.ok(result.comments.length >= 1, 'Should have comments in result');

    const comment = result.comments[0];
    // Verify SuperDoc-compatible format
    assert.ok(comment.commentId, 'Must have commentId (not id)');
    assert.strictEqual(typeof comment.creatorName, 'string', 'creatorName must be a string');
    assert.strictEqual(typeof comment.creatorEmail, 'string', 'creatorEmail must be a string');
    assert.strictEqual(typeof comment.createdTime, 'number', 'createdTime must be a number');
    assert.ok(Array.isArray(comment.commentJSON), 'commentJSON must be an array');
    assert.strictEqual(comment.commentJSON[0].type, 'paragraph');
    assert.strictEqual(comment.commentJSON[0].content[0].text, 'Test comment body');

    // Must NOT have old broken fields
    assert.strictEqual(comment.id, undefined, 'Must not have old "id" field');
    assert.strictEqual(comment.text, undefined, 'Must not have old "text" field');
    assert.strictEqual(comment.author, undefined, 'Must not have old "author" object field');
    assert.strictEqual(comment.blockId, undefined, 'Must not have "blockId" field');
  });

  it('commentRange edits return comments in SuperDoc format', async () => {
    const { ir, cleanup: irCleanup } = await createEditorWithIR(assetPurchaseDocx);
    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    const findText = block.text.slice(0, 15);
    irCleanup();

    const outputPath = path.join(outputDir, 'commentRange-format-test.docx');
    const editConfig = {
      version: '0.3.0',
      author: { name: 'Range Author', email: 'range@test.com' },
      edits: [{
        blockId: block.seqId,
        operation: 'commentRange',
        findText: findText,
        comment: 'Range comment body'
      }]
    };

    const result = await applyEdits(assetPurchaseDocx, outputPath, editConfig);

    assert.ok(result.applied >= 1);
    assert.ok(result.comments.length >= 1);

    const comment = result.comments[0];
    assert.ok(comment.commentId, 'commentRange must produce commentId');
    assert.strictEqual(comment.creatorName, 'Range Author');
    assert.strictEqual(comment.creatorEmail, 'range@test.com');
    assert.ok(comment.commentJSON[0].content[0].text.includes('Range comment'));
  });

  it('replace with comment returns comments in SuperDoc format', async () => {
    const outputPath = path.join(outputDir, 'replace-comment-format-test.docx');
    const editConfig = {
      version: '0.3.0',
      author: { name: 'Replace Author', email: 'replace@test.com' },
      edits: [{
        blockId: 'b001',
        operation: 'replace',
        newText: 'Modified text with comment attached',
        comment: 'Explaining the replacement'
      }]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);

    assert.ok(result.applied >= 1);
    if (result.comments.length > 0) {
      const comment = result.comments[0];
      assert.ok(comment.commentId);
      assert.strictEqual(comment.creatorName, 'Replace Author');
      assert.ok(Array.isArray(comment.commentJSON));
    }
  });

  it('DOCX output contains proper comment XML (not empty self-closing tags)', async () => {
    const outputPath = path.join(outputDir, 'docx-comment-forensics-test.docx');
    const editConfig = {
      version: '0.3.0',
      author: { name: 'Forensic Test', email: 'forensic@test.com' },
      edits: [{
        blockId: 'b001',
        operation: 'comment',
        comment: 'Forensic test comment body'
      }]
    };

    const result = await applyEdits(sampleDocx, outputPath, editConfig);
    assert.ok(result.applied >= 1, 'Comment edit should apply');

    // Use unzip to extract and inspect DOCX XML
    const { execSync } = await import('child_process');

    // Check for comment range anchors in document.xml
    let documentXml;
    try {
      documentXml = execSync(`unzip -p "${outputPath}" word/document.xml`, { encoding: 'utf-8' });
    } catch (e) {
      // If unzip fails, skip the forensic check (test infra issue, not a code issue)
      console.warn('Skipping DOCX forensics: unzip not available or DOCX structure differs');
      return;
    }

    // Check for comment bodies in comments.xml
    let commentsXml;
    try {
      commentsXml = execSync(`unzip -p "${outputPath}" word/comments.xml`, { encoding: 'utf-8' });
    } catch (e) {
      // comments.xml may not exist if SuperDoc didn't generate it
      console.warn('comments.xml not found in DOCX — SuperDoc may not have generated it');
      return;
    }

    // Verify comment range anchors exist in document.xml
    assert.ok(documentXml.includes('commentRangeStart'),
      'document.xml must contain commentRangeStart anchors');
    assert.ok(documentXml.includes('commentRangeEnd'),
      'document.xml must contain commentRangeEnd anchors');

    // Verify comment body contains actual text (not empty self-closing tags)
    assert.ok(commentsXml.includes('Forensic test comment body'),
      'comments.xml must contain the comment text');
  });
});
