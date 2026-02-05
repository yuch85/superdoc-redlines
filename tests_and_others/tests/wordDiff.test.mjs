// tests/wordDiff.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { tokenize, computeWordDiff, getDiffStats, diffToOperations } from '../../src/wordDiff.mjs';

describe('Word-Level Diff', () => {
  describe('tokenize', () => {
    it('tokenizes words', () => {
      const tokens = tokenize('hello world');
      assert.deepStrictEqual(tokens, ['hello', ' ', 'world']);
    });

    it('tokenizes punctuation separately', () => {
      const tokens = tokenize('Hello, world!');
      assert.deepStrictEqual(tokens, ['Hello', ',', ' ', 'world', '!']);
    });

    it('handles multiple spaces', () => {
      const tokens = tokenize('hello   world');
      assert.deepStrictEqual(tokens, ['hello', '   ', 'world']);
    });

    it('handles empty string', () => {
      const tokens = tokenize('');
      assert.deepStrictEqual(tokens, []);
    });

    it('handles numbers', () => {
      const tokens = tokenize('Article 123');
      assert.deepStrictEqual(tokens, ['Article', ' ', '123']);
    });

    it('handles mixed content', () => {
      const tokens = tokenize('Price: $100.00');
      assert.deepStrictEqual(tokens, ['Price', ':', ' ', '$', '100', '.', '00']);
    });
  });

  describe('computeWordDiff', () => {
    it('detects single word change', () => {
      const diffs = computeWordDiff('Hello world', 'Hello there');
      // Should have: equal "Hello ", delete "world", insert "there"
      assert.ok(diffs.some(d => d[0] === -1 && d[1].includes('world')));
      assert.ok(diffs.some(d => d[0] === 1 && d[1].includes('there')));
    });

    it('detects identical text', () => {
      const diffs = computeWordDiff('Hello world', 'Hello world');
      // All should be equal (op === 0)
      assert.ok(diffs.every(d => d[0] === 0));
    });

    it('handles insertions', () => {
      const diffs = computeWordDiff('Hello world', 'Hello beautiful world');
      assert.ok(diffs.some(d => d[0] === 1 && d[1].includes('beautiful')));
    });

    it('handles deletions', () => {
      const diffs = computeWordDiff('Hello beautiful world', 'Hello world');
      assert.ok(diffs.some(d => d[0] === -1 && d[1].includes('beautiful')));
    });

    it('handles complete replacement', () => {
      const diffs = computeWordDiff('foo bar baz', 'one two three');
      assert.ok(diffs.some(d => d[0] === -1));
      assert.ok(diffs.some(d => d[0] === 1));
    });

    it('preserves punctuation as separate tokens', () => {
      const diffs = computeWordDiff('Hello, world!', 'Hello, there!');
      // Punctuation should be preserved
      const allText = diffs.map(d => d[1]).join('');
      assert.ok(allText.includes(','));
      assert.ok(allText.includes('!'));
    });
  });

  describe('getDiffStats', () => {
    it('returns correct counts for single word change', () => {
      const stats = getDiffStats('Hello world', 'Hello there');
      assert.ok(stats.deletions > 0);
      assert.ok(stats.insertions > 0);
      assert.ok(stats.unchanged > 0);
    });

    it('returns zero changes for identical text', () => {
      const stats = getDiffStats('Hello world', 'Hello world');
      assert.strictEqual(stats.deletions, 0);
      assert.strictEqual(stats.insertions, 0);
      assert.ok(stats.unchanged > 0);
    });

    it('counts multiple changes', () => {
      const stats = getDiffStats(
        'The quick brown fox',
        'The slow brown dog'
      );
      // 'quick' -> 'slow', 'fox' -> 'dog'
      assert.ok(stats.deletions >= 2);  // 'quick' and 'fox' (may include spaces)
      assert.ok(stats.insertions >= 2); // 'slow' and 'dog'
    });

    it('handles pure insertion', () => {
      const stats = getDiffStats('Hello', 'Hello world');
      assert.strictEqual(stats.deletions, 0);
      assert.ok(stats.insertions > 0);
    });

    it('handles pure deletion', () => {
      const stats = getDiffStats('Hello world', 'Hello');
      assert.ok(stats.deletions > 0);
      assert.strictEqual(stats.insertions, 0);
    });
  });

  describe('diffToOperations', () => {
    it('converts to replace operation for adjacent delete+insert', () => {
      const ops = diffToOperations('English law', 'Singapore law');
      assert.ok(ops.some(op =>
        op.type === 'replace' &&
        op.deleteText.includes('English') &&
        op.insertText.includes('Singapore')
      ));
    });

    it('creates delete operation', () => {
      const ops = diffToOperations('Hello beautiful world', 'Hello world');
      assert.ok(ops.some(op => op.type === 'delete'));
    });

    it('creates insert operation', () => {
      const ops = diffToOperations('Hello world', 'Hello beautiful world');
      assert.ok(ops.some(op => op.type === 'insert'));
    });

    it('returns empty array for identical text', () => {
      const ops = diffToOperations('Hello world', 'Hello world');
      assert.strictEqual(ops.length, 0);
    });

    it('includes position information', () => {
      const ops = diffToOperations('Hello world', 'Hello there');
      const replaceOp = ops.find(op => op.type === 'replace');
      assert.ok(replaceOp);
      assert.ok(typeof replaceOp.position === 'number');
    });

    it('handles multiple changes', () => {
      const ops = diffToOperations(
        'The quick brown fox jumps',
        'The slow brown dog leaps'
      );
      // Should have changes for quick->slow, fox->dog, jumps->leaps
      assert.ok(ops.length >= 2);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty strings', () => {
      const stats = getDiffStats('', '');
      assert.strictEqual(stats.deletions, 0);
      assert.strictEqual(stats.insertions, 0);
    });

    it('handles empty to text', () => {
      const stats = getDiffStats('', 'Hello world');
      assert.ok(stats.insertions > 0);
    });

    it('handles text to empty', () => {
      const stats = getDiffStats('Hello world', '');
      assert.ok(stats.deletions > 0);
    });

    it('handles special characters', () => {
      const diffs = computeWordDiff(
        'Price: $100.00',
        'Price: $200.00'
      );
      assert.ok(diffs.some(d => d[0] === -1));
      assert.ok(diffs.some(d => d[0] === 1));
    });

    it('handles newlines', () => {
      const stats = getDiffStats(
        'Line one\nLine two',
        'Line one\nLine three'
      );
      assert.ok(stats.deletions > 0);
      assert.ok(stats.insertions > 0);
    });
  });
});
