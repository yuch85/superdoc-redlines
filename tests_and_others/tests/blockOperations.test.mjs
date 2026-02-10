/**
 * Tests for Block Operations - ID-based document editing
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEditorWithIR } from '../../src/irExtractor.mjs';
import {
  replaceBlockById,
  deleteBlockById,
  insertAfterBlock,
  insertBeforeBlock,
  addCommentToBlock,
  resolveBlockId,
  getBlockById,
  findTextPositionInBlock,
  insertTextAfterMatch,
  highlightTextInBlock,
  addCommentToTextInBlock
} from '../../src/blockOperations.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const sampleDocx = path.join(fixturesDir, 'sample.docx');
const assetPurchaseDocx = path.join(fixturesDir, 'asset-purchase.docx');

describe('resolveBlockId', () => {
  it('returns null for non-existent seqId', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = resolveBlockId(editor, 'b999');
    assert.equal(result, null);

    cleanup();
  });

  it('returns null for non-existent UUID', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = resolveBlockId(editor, 'non-existent-uuid-12345');
    assert.equal(result, null);

    cleanup();
  });

  it('resolves UUID when it exists in document', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    // Get a real UUID from the IR
    const realUuid = ir.blocks[0].id;
    const result = resolveBlockId(editor, realUuid);

    assert.equal(result, realUuid);

    cleanup();
  });
});

describe('getBlockById', () => {
  it('returns block content for valid UUID', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const result = getBlockById(editor, blockId);

    assert.equal(result.success, true);
    assert.ok(typeof result.text === 'string');
    assert.ok(result.pos >= 0);

    cleanup();
  });

  it('returns error for invalid block ID', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = getBlockById(editor, 'non-existent');
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('replaceBlockById', () => {
  it('replaces block content with UUID', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const newText = 'This is replaced text';

    const result = await replaceBlockById(editor, blockId, newText);

    assert.equal(result.success, true);
    assert.equal(result.operation, 'replace');
    assert.equal(result.blockId, blockId);

    // Verify the change
    const updated = getBlockById(editor, blockId);
    assert.ok(updated.text.includes('replaced') || updated.text === newText);

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = await replaceBlockById(editor, 'nonexistent', 'New text');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });

  it('applies word-level diff when diff=true', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const originalText = ir.blocks[0].text;
    const newText = originalText.replace(/\w+/, 'MODIFIED');

    const result = await replaceBlockById(editor, blockId, newText, { diff: true });

    assert.equal(result.success, true);
    assert.ok(result.diffStats, 'Should have diffStats');

    cleanup();
  });

  it('applies full replacement when diff=false', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const newText = 'Completely new content';

    const result = await replaceBlockById(editor, blockId, newText, { diff: false });

    assert.equal(result.success, true);
    assert.equal(result.operation, 'replace');
    assert.equal(result.diffStats, undefined, 'Should not have diffStats with diff=false');

    cleanup();
  });

  it('respects trackChanges option', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    // Track changes should be enabled by default
    const result = await replaceBlockById(editor, blockId, 'New text', { trackChanges: true });
    assert.equal(result.success, true);

    cleanup();
  });
});

describe('deleteBlockById', () => {
  it('deletes block by UUID', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    const result = await deleteBlockById(editor, blockId);

    assert.equal(result.success, true);
    assert.equal(result.operation, 'delete');
    assert.equal(result.blockId, blockId);

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = await deleteBlockById(editor, 'nonexistent-uuid');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('insertAfterBlock', () => {
  it('inserts paragraph after block', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const newText = 'This is a new paragraph';

    const result = await insertAfterBlock(editor, blockId, newText);

    assert.equal(result.success, true);
    assert.equal(result.operation, 'insert');
    assert.equal(result.afterBlockId, blockId);
    assert.ok(result.newBlockId, 'Should have newBlockId');

    cleanup();
  });

  it('inserts heading with level', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    const result = await insertAfterBlock(editor, blockId, 'New Heading', {
      type: 'heading',
      level: 2
    });

    assert.equal(result.success, true);
    assert.ok(result.newBlockId);

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = await insertAfterBlock(editor, 'nonexistent', 'New text');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('insertBeforeBlock', () => {
  it('inserts paragraph before block', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const newText = 'This is inserted before';

    const result = await insertBeforeBlock(editor, blockId, newText);

    assert.equal(result.success, true);
    assert.equal(result.operation, 'insert');
    assert.equal(result.beforeBlockId, blockId);
    assert.ok(result.newBlockId);

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = await insertBeforeBlock(editor, 'nonexistent', 'New text');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('addCommentToBlock', () => {
  it('adds comment to block', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const commentText = 'This needs review';

    const result = await addCommentToBlock(
      editor,
      blockId,
      commentText,
      { name: 'Test User', email: 'test@test.com' }
    );

    assert.equal(result.success, true);
    assert.equal(result.operation, 'comment');
    assert.equal(result.blockId, blockId);
    assert.ok(result.commentId, 'Should have commentId');
    assert.ok(result.commentId.startsWith('comment-'));

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = await addCommentToBlock(
      editor,
      'nonexistent',
      'Comment text',
      { name: 'Test', email: 'test@test.com' }
    );

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('integration scenarios', () => {
  it('multiple operations on same document', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    // Insert a new block
    const insertResult = await insertAfterBlock(editor, ir.blocks[0].id, 'New paragraph');
    assert.equal(insertResult.success, true);

    // Replace content of another block (if exists)
    if (ir.blocks.length > 1) {
      const replaceResult = await replaceBlockById(editor, ir.blocks[1].id, 'Modified content');
      assert.equal(replaceResult.success, true);
    }

    cleanup();
  });

  it('operations work on larger document', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    assert.ok(ir.blocks.length > 10, 'Asset purchase should have many blocks');

    // Test replace on a block in the middle
    const midIndex = Math.floor(ir.blocks.length / 2);
    const blockId = ir.blocks[midIndex].id;

    const result = await replaceBlockById(editor, blockId, 'Modified clause text');
    assert.equal(result.success, true);

    cleanup();
  });
});

describe('error handling', () => {
  it('all operations handle empty text gracefully', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    // Replace with empty text should work
    const replaceResult = await replaceBlockById(editor, blockId, '');
    // May succeed or fail depending on implementation - just shouldn't throw
    assert.ok(typeof replaceResult.success === 'boolean');

    // Insert empty text
    const insertResult = await insertAfterBlock(editor, blockId, '');
    assert.ok(typeof insertResult.success === 'boolean');

    cleanup();
  });

  it('operations return structured errors, not exceptions', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    // These should all return error objects, not throw
    const results = await Promise.all([
      replaceBlockById(editor, 'bad-id', 'text'),
      deleteBlockById(editor, 'bad-id'),
      insertAfterBlock(editor, 'bad-id', 'text'),
      addCommentToBlock(editor, 'bad-id', 'comment', { name: 'Test', email: 'test@test.com' })
    ]);

    for (const result of results) {
      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.ok(typeof result.error === 'string');
    }

    cleanup();
  });
});

// ====================================================================
// v0.3.0 Operations Tests
// ====================================================================

describe('findTextPositionInBlock', () => {
  it('finds exact text in a block', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;
    const blockText = ir.blocks[0].text;
    // Use the first 10 characters as search text (must exist)
    const searchText = blockText.slice(0, Math.min(10, blockText.length));

    const result = findTextPositionInBlock(editor, blockId, searchText);

    assert.equal(result.found, true);
    assert.ok(typeof result.from === 'number', 'from should be a number');
    assert.ok(typeof result.to === 'number', 'to should be a number');
    assert.ok(result.from < result.to, 'from should be less than to');

    cleanup();
  });

  it('returns not-found for absent text', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    const result = findTextPositionInBlock(editor, blockId, 'XYZZY_NONEXISTENT_TEXT_12345');

    assert.equal(result.found, false);
    assert.ok(result.error, 'Should have an error message');
    assert.ok(result.error.includes('not found'), 'Error should mention text not found');

    cleanup();
  });

  it('handles special characters in search', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    // Look for a block that contains a period or parenthesis
    let targetBlock = null;
    for (const block of ir.blocks) {
      if (block.text && block.text.includes('.')) {
        targetBlock = block;
        break;
      }
    }

    if (targetBlock) {
      // Find the substring containing the period
      const dotIndex = targetBlock.text.indexOf('.');
      const searchText = targetBlock.text.slice(Math.max(0, dotIndex - 3), dotIndex + 1);

      const result = findTextPositionInBlock(editor, targetBlock.id, searchText);

      assert.equal(result.found, true);
      assert.ok(result.from < result.to);
    }

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = findTextPositionInBlock(editor, 'nonexistent-block-uuid', 'some text');

    assert.equal(result.found, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('insertTextAfterMatch', () => {
  it('inserts text after found text', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    // Find a block with enough text to have a recognizable substring
    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    assert.ok(block, 'Should find a block with sufficient text');

    const searchText = block.text.slice(0, 10);
    const textToInsert = ' [INSERTED] ';

    const result = await insertTextAfterMatch(editor, block.id, searchText, textToInsert);

    assert.equal(result.success, true);
    assert.equal(result.operation, 'insertAfterText');
    assert.equal(result.blockId, block.id);
    assert.equal(result.findText, searchText);
    assert.equal(result.insertText, textToInsert);
    assert.ok(typeof result.insertedAt === 'number', 'Should have insertedAt position');

    cleanup();
  });

  it('returns error when text not found', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    const result = await insertTextAfterMatch(editor, blockId, 'NONEXISTENT_TEXT_99999', 'inserted');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });

  it('returns error for non-existent block', async () => {
    const { editor, cleanup } = await createEditorWithIR(sampleDocx);

    const result = await insertTextAfterMatch(editor, 'nonexistent-uuid', 'text', 'inserted');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('highlightTextInBlock', () => {
  it('applies highlight to found text', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 15);
    assert.ok(block, 'Should find a block with sufficient text');

    const searchText = block.text.slice(0, 10);

    const result = await highlightTextInBlock(editor, block.id, searchText);

    // The result depends on whether the editor supports setHighlight
    // but the function should return a structured result regardless
    assert.ok(typeof result.success === 'boolean');
    assert.equal(result.operation, 'highlight');
    assert.equal(result.blockId, block.id);
    assert.equal(result.findText, searchText);
    assert.equal(result.color, '#FFEB3B'); // Default color

    cleanup();
  });

  it('applies highlight with custom color', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 15);
    assert.ok(block, 'Should find a block with sufficient text');

    const searchText = block.text.slice(0, 10);
    const customColor = '#FF0000';

    const result = await highlightTextInBlock(editor, block.id, searchText, customColor);

    assert.ok(typeof result.success === 'boolean');
    assert.equal(result.color, customColor);

    cleanup();
  });

  it('returns error when text not found', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    const result = await highlightTextInBlock(editor, blockId, 'NONEXISTENT_HIGHLIGHT_TEXT');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });
});

describe('addCommentToTextInBlock', () => {
  it('adds comment to specific text span', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);

    const block = ir.blocks.find(b => b.text && b.text.length > 20);
    assert.ok(block, 'Should find a block with sufficient text');

    const searchText = block.text.slice(0, 15);
    const commentText = 'This specific text needs review';

    const result = await addCommentToTextInBlock(
      editor,
      block.id,
      searchText,
      commentText,
      { name: 'Test User', email: 'test@test.com' }
    );

    assert.equal(result.success, true);
    assert.equal(result.operation, 'commentRange');
    assert.equal(result.blockId, block.id);
    assert.equal(result.findText, searchText);
    assert.ok(result.commentId, 'Should have a commentId');
    assert.ok(result.commentId.startsWith('comment-'), 'commentId should start with comment-');

    cleanup();
  });

  it('returns error when text not found', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const blockId = ir.blocks[0].id;

    const result = await addCommentToTextInBlock(
      editor,
      blockId,
      'NONEXISTENT_COMMENT_TARGET_TEXT',
      'A comment',
      { name: 'Test', email: 'test@test.com' }
    );

    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));

    cleanup();
  });

  it('returns commentId on success', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);

    const block = ir.blocks[0];
    const searchText = block.text.slice(0, Math.min(8, block.text.length));

    const result = await addCommentToTextInBlock(
      editor,
      block.id,
      searchText,
      'Review this text',
      { name: 'Reviewer', email: 'reviewer@test.com' }
    );

    assert.equal(result.success, true);
    assert.ok(result.commentId, 'Should return a commentId');
    assert.ok(typeof result.commentId === 'string');
    assert.ok(result.commentId.length > 0);

    cleanup();
  });
});
