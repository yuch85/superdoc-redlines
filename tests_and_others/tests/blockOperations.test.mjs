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
  getBlockById
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
