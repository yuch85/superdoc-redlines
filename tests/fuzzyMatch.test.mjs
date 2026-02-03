// tests/fuzzyMatch.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { findTextFuzzy, makeFuzzyRegex, replaceSmartQuotes } from '../src/fuzzyMatch.mjs';

// Smart quote characters for testing
const LEFT_DOUBLE = '\u201C';  // "
const RIGHT_DOUBLE = '\u201D'; // "
const LEFT_SINGLE = '\u2018';  // '
const RIGHT_SINGLE = '\u2019'; // '

describe('Fuzzy Matching', () => {
  describe('replaceSmartQuotes', () => {
    it('replaces left double quotes', () => {
      assert.strictEqual(replaceSmartQuotes(LEFT_DOUBLE + 'hello'), '"hello');
    });

    it('replaces right double quotes', () => {
      assert.strictEqual(replaceSmartQuotes('hello' + RIGHT_DOUBLE), 'hello"');
    });

    it('replaces left single quotes', () => {
      assert.strictEqual(replaceSmartQuotes(LEFT_SINGLE + 'hello'), "'hello");
    });

    it('replaces right single quotes', () => {
      assert.strictEqual(replaceSmartQuotes('hello' + RIGHT_SINGLE), "hello'");
    });

    it('handles mixed quotes', () => {
      const input = LEFT_DOUBLE + 'Hello,' + RIGHT_DOUBLE + ' she said, ' + LEFT_SINGLE + 'Hi' + RIGHT_SINGLE;
      assert.strictEqual(replaceSmartQuotes(input), '"Hello," she said, \'Hi\'');
    });
  });

  describe('Tier 1: Exact Match', () => {
    it('finds exact text', () => {
      const result = findTextFuzzy('The quick brown fox', 'quick');
      assert.strictEqual(result.start, 4);
      assert.strictEqual(result.end, 9);
      assert.strictEqual(result.tier, 'exact');
    });

    it('finds text at start', () => {
      const result = findTextFuzzy('Hello world', 'Hello');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.tier, 'exact');
    });

    it('finds text at end', () => {
      const result = findTextFuzzy('Hello world', 'world');
      assert.strictEqual(result.start, 6);
      assert.strictEqual(result.tier, 'exact');
    });

    it('finds exact phrase with punctuation', () => {
      const result = findTextFuzzy('Hello, world!', 'Hello, world!');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.tier, 'exact');
    });
  });

  describe('Tier 2: Smart Quote Normalization', () => {
    it('matches smart double quotes with straight quotes', () => {
      const text = LEFT_DOUBLE + 'Hello' + RIGHT_DOUBLE + ' said the fox';
      const result = findTextFuzzy(text, '"Hello"');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.end, 7);
      assert.strictEqual(result.tier, 'smartQuote');
    });

    it('matches straight quotes with smart quotes', () => {
      const result = findTextFuzzy('"Hello" said the fox', LEFT_DOUBLE + 'Hello' + RIGHT_DOUBLE);
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.tier, 'smartQuote');
    });

    it('matches smart single quotes', () => {
      const text = 'It' + RIGHT_SINGLE + 's a test';
      const result = findTextFuzzy(text, "It's a test");
      assert.ok(result);
      assert.strictEqual(result.tier, 'smartQuote');
    });

    it('matches mixed smart and straight quotes', () => {
      const text = LEFT_DOUBLE + 'Don' + RIGHT_SINGLE + 't' + RIGHT_DOUBLE + ' worry';
      const result = findTextFuzzy(text, '"Don\'t"');
      assert.ok(result);
    });
  });

  describe('Tier 3: Fuzzy Regex Match', () => {
    it('matches variable whitespace', () => {
      const result = findTextFuzzy('hello   world', 'hello world');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.end, 13);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('matches tabs as whitespace', () => {
      const result = findTextFuzzy('hello\tworld', 'hello world');
      assert.ok(result);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('matches newlines as whitespace', () => {
      const result = findTextFuzzy('hello\nworld', 'hello world');
      assert.ok(result);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('matches variable underscores (placeholder)', () => {
      const result = findTextFuzzy('Sign here: [__________]', 'Sign here: [___]');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('matches different underscore counts', () => {
      // Use a pattern that won't match exactly but will match with fuzzy underscore handling
      const result = findTextFuzzy('Fill in here: _', 'Fill in here: ___');
      assert.ok(result);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('ignores markdown bold formatting', () => {
      const result = findTextFuzzy('**Hello** world', 'Hello world');
      assert.ok(result);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('ignores markdown italic formatting', () => {
      const result = findTextFuzzy('_Hello_ world', 'Hello world');
      assert.ok(result);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('handles multiple markdown markers', () => {
      const result = findTextFuzzy('**_Hello_** world', 'Hello world');
      assert.ok(result);
    });
  });

  describe('No Match', () => {
    it('returns null when text not found', () => {
      const result = findTextFuzzy('The quick brown fox', 'elephant');
      assert.strictEqual(result, null);
    });

    it('returns null for empty target', () => {
      const result = findTextFuzzy('Hello world', '');
      assert.strictEqual(result, null);
    });

    it('returns null for null target', () => {
      const result = findTextFuzzy('Hello world', null);
      assert.strictEqual(result, null);
    });

    it('returns null when target longer than text', () => {
      const result = findTextFuzzy('Hi', 'Hello world how are you');
      assert.strictEqual(result, null);
    });
  });

  describe('Edge Cases', () => {
    it('handles regex special characters in search', () => {
      const result = findTextFuzzy('Price: $100.00 (USD)', '$100.00');
      assert.ok(result);
      assert.strictEqual(result.matchedText, '$100.00');
    });

    it('handles parentheses in search', () => {
      const result = findTextFuzzy('Function call: foo(bar)', 'foo(bar)');
      assert.ok(result);
    });

    it('handles brackets in search', () => {
      const result = findTextFuzzy('Array: [1, 2, 3]', '[1, 2, 3]');
      assert.ok(result);
    });

    it('preserves original text in matchedText', () => {
      const text = LEFT_DOUBLE + 'Hello' + RIGHT_DOUBLE + '  world';
      const result = findTextFuzzy(text, '"Hello" world');
      assert.ok(result);
      // matchedText should be from original
      assert.ok(result.matchedText.includes('Hello'));
    });

    it('handles unicode characters', () => {
      const result = findTextFuzzy('Cafe resume naive', 'resume');
      assert.ok(result);
      assert.strictEqual(result.matchedText, 'resume');
    });
  });

  describe('makeFuzzyRegex', () => {
    it('creates valid regex', () => {
      const regex = makeFuzzyRegex('hello world');
      assert.ok(regex instanceof RegExp);
    });

    it('regex matches variable whitespace', () => {
      const regex = makeFuzzyRegex('hello world');
      assert.ok(regex.test('hello   world'));
      assert.ok(regex.test('hello\tworld'));
    });

    it('regex matches variable underscores', () => {
      const regex = makeFuzzyRegex('sign___here');
      assert.ok(regex.test('sign_here'));
      assert.ok(regex.test('sign__________here'));
    });
  });
});
