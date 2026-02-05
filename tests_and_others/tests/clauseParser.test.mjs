// tests/clauseParser.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  parseClauseNumber,
  analyzeHeading,
  Clause,
  findClause,
  getClauseRange
} from '../../src/clauseParser.mjs';

describe('Clause Parser', () => {
  describe('parseClauseNumber', () => {
    it('parses simple numbered clauses', () => {
      const result = parseClauseNumber('1. Definitions');
      assert.deepStrictEqual(result, {
        type: 'numbered',
        number: '1',
        remainder: 'Definitions'
      });
    });

    it('parses double-digit numbered clauses', () => {
      const result = parseClauseNumber('12. Warranties');
      assert.strictEqual(result.type, 'numbered');
      assert.strictEqual(result.number, '12');
    });

    it('parses nested numbered clauses', () => {
      const result = parseClauseNumber('3.2.1 Sub-sub-clause');
      assert.deepStrictEqual(result, {
        type: 'numbered',
        number: '3.2.1',
        remainder: 'Sub-sub-clause'
      });
    });

    it('parses deeply nested clauses', () => {
      const result = parseClauseNumber('1.2.3.4.5 Deep clause');
      assert.strictEqual(result.type, 'numbered');
      assert.strictEqual(result.number, '1.2.3.4.5');
    });

    it('parses lettered clauses', () => {
      const result = parseClauseNumber('(a) First item');
      assert.deepStrictEqual(result, {
        type: 'lettered',
        number: 'a',
        remainder: 'First item'
      });
    });

    it('parses uppercase lettered clauses', () => {
      const result = parseClauseNumber('(A) First item');
      assert.strictEqual(result.type, 'lettered');
      assert.strictEqual(result.number, 'A');
    });

    it('parses roman numeral clauses', () => {
      const result = parseClauseNumber('iv. Fourth item');
      assert.strictEqual(result.type, 'roman');
      assert.strictEqual(result.number, 'iv');
    });

    it('parses complex roman numerals', () => {
      const result = parseClauseNumber('xiii. Thirteenth item');
      assert.strictEqual(result.type, 'roman');
      assert.strictEqual(result.number, 'xiii');
    });

    it('parses bracketed numbers', () => {
      const result = parseClauseNumber('[1] First item');
      assert.strictEqual(result.type, 'bracketed');
      assert.strictEqual(result.number, '1');
    });

    it('parses Article style', () => {
      const result = parseClauseNumber('Article 5 - Warranties');
      assert.strictEqual(result.type, 'article');
      assert.strictEqual(result.number, '5');
    });

    it('parses Article with Roman numerals', () => {
      const result = parseClauseNumber('Article III Interpretation');
      assert.strictEqual(result.type, 'article');
      assert.strictEqual(result.number, 'III');
    });

    it('parses Schedule style', () => {
      const result = parseClauseNumber('Schedule 1 - Definitions');
      assert.strictEqual(result.type, 'schedule');
    });

    it('parses Exhibit style', () => {
      const result = parseClauseNumber('Exhibit A - Terms');
      assert.strictEqual(result.type, 'schedule');
    });

    it('parses Appendix style', () => {
      const result = parseClauseNumber('Appendix 2 - Forms');
      assert.strictEqual(result.type, 'schedule');
    });

    it('returns null for non-clause text', () => {
      const result = parseClauseNumber('This is regular paragraph text.');
      assert.strictEqual(result, null);
    });

    it('returns null for empty string', () => {
      const result = parseClauseNumber('');
      assert.strictEqual(result, null);
    });

    it('handles leading whitespace', () => {
      const result = parseClauseNumber('   1. Definitions');
      assert.strictEqual(result.type, 'numbered');
      assert.strictEqual(result.number, '1');
    });
  });

  describe('analyzeHeading', () => {
    it('detects ALL CAPS as heading', () => {
      const node = { attrs: {} };
      const result = analyzeHeading(node, 'DEFINITIONS');
      assert.strictEqual(result.isHeading, true);
      assert.strictEqual(result.title, 'DEFINITIONS');
    });

    it('detects Heading style attribute', () => {
      const node = { attrs: { style: 'Heading 1' } };
      const result = analyzeHeading(node, 'Introduction');
      assert.strictEqual(result.isHeading, true);
      assert.strictEqual(result.level, 1);
    });

    it('detects Heading 2 style', () => {
      const node = { attrs: { style: 'Heading 2' } };
      const result = analyzeHeading(node, 'Subsection');
      assert.strictEqual(result.isHeading, true);
      assert.strictEqual(result.level, 2);
    });

    it('returns isHeading false for normal text', () => {
      const node = { attrs: {} };
      const result = analyzeHeading(node, 'This is regular text that goes on for a while and is not a heading.');
      assert.strictEqual(result.isHeading, false);
    });

    it('rejects long ALL CAPS text', () => {
      const node = { attrs: {} };
      const longText = 'A'.repeat(150);
      const result = analyzeHeading(node, longText);
      assert.strictEqual(result.isHeading, false);
    });

    it('rejects ALL CAPS without letters', () => {
      const node = { attrs: {} };
      const result = analyzeHeading(node, '123 456');
      assert.strictEqual(result.isHeading, false);
    });
  });

  describe('Clause class', () => {
    it('creates clause with all properties', () => {
      const clause = new Clause({
        number: '3.2',
        heading: 'Warranties',
        level: 2,
        startPos: 100,
        endPos: 500,
        text: '3.2 Warranties\nThe Seller warrants...'
      });

      assert.strictEqual(clause.number, '3.2');
      assert.strictEqual(clause.heading, 'Warranties');
      assert.strictEqual(clause.level, 2);
      assert.strictEqual(clause.startPos, 100);
      assert.strictEqual(clause.endPos, 500);
    });

    it('computes fullNumber with parent', () => {
      const parent = new Clause({
        number: '3',
        heading: 'Main',
        level: 1,
        startPos: 0,
        endPos: 1000,
        text: '3. Main'
      });

      const child = new Clause({
        number: '2',
        heading: 'Sub',
        level: 2,
        startPos: 100,
        endPos: 500,
        text: '3.2 Sub'
      });

      child.parent = parent;
      parent.children.push(child);

      assert.strictEqual(child.fullNumber, '3.2');
    });

    it('returns number as fullNumber when no parent', () => {
      const clause = new Clause({
        number: '5',
        heading: 'Standalone',
        level: 1,
        startPos: 0,
        endPos: 100,
        text: '5. Standalone'
      });

      assert.strictEqual(clause.fullNumber, '5');
    });
  });

  describe('findClause', () => {
    let index;

    // Set up a sample index
    beforeEach(() => {
      index = new Map();

      const clause1 = new Clause({
        number: '1',
        heading: 'Definitions',
        level: 1,
        startPos: 0,
        endPos: 100,
        text: '1. Definitions'
      });

      const clause32 = new Clause({
        number: '3.2',
        heading: 'Warranties',
        level: 2,
        startPos: 200,
        endPos: 300,
        text: '3.2 Warranties'
      });

      index.set('1', clause1);
      index.set('definitions', clause1);
      index.set('3.2', clause32);
      index.set('warranties', clause32);
    });

    it('finds by exact number', () => {
      const clause = findClause(index, { number: '3.2' });
      assert.strictEqual(clause.number, '3.2');
    });

    it('finds by heading (case-insensitive)', () => {
      const clause = findClause(index, { heading: 'DEFINITIONS' });
      assert.strictEqual(clause.heading, 'Definitions');
    });

    it('finds by partial heading match', () => {
      const clause = findClause(index, { heading: 'warrant' });
      assert.strictEqual(clause.number, '3.2');
    });

    it('returns null for non-existent number', () => {
      const clause = findClause(index, { number: '99' });
      assert.strictEqual(clause, null);
    });

    it('returns null for non-existent heading', () => {
      const clause = findClause(index, { heading: 'nonexistent' });
      assert.strictEqual(clause, null);
    });
  });

  describe('getClauseRange', () => {
    it('returns full range with subclauses', () => {
      const clause = new Clause({
        number: '1',
        heading: 'Main',
        level: 1,
        startPos: 0,
        endPos: 500,
        text: '1. Main'
      });

      const range = getClauseRange(clause, true);
      assert.deepStrictEqual(range, { from: 0, to: 500 });
    });

    it('returns range up to first child when excluding subclauses', () => {
      const parent = new Clause({
        number: '1',
        heading: 'Main',
        level: 1,
        startPos: 0,
        endPos: 500,
        text: '1. Main'
      });

      const child = new Clause({
        number: '1.1',
        heading: 'Sub',
        level: 2,
        startPos: 100,
        endPos: 300,
        text: '1.1 Sub'
      });

      parent.children.push(child);

      const range = getClauseRange(parent, false);
      assert.deepStrictEqual(range, { from: 0, to: 100 });
    });

    it('returns full range when no children and excluding subclauses', () => {
      const clause = new Clause({
        number: '1',
        heading: 'Main',
        level: 1,
        startPos: 0,
        endPos: 500,
        text: '1. Main'
      });

      const range = getClauseRange(clause, false);
      assert.deepStrictEqual(range, { from: 0, to: 500 });
    });
  });
});

// Note: beforeEach is available in Node.js test runner v20.1.0+
// For older versions, just inline the setup in each test
