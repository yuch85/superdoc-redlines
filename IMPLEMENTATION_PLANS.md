# Implementation Plans: superdoc-redlines Feature Enhancements

This document contains detailed implementation plans for four major features to reduce IDE agent orchestration burden when performing complex contract amendments.

---

## Table of Contents

1. [Feature 1: Fuzzy Matching](#feature-1-fuzzy-matching)
2. [Feature 2: Occurrence Selector](#feature-2-occurrence-selector)
3. [Feature 3: Word-Level Diff](#feature-3-word-level-diff)
4. [Feature 4: Clause Targeting](#feature-4-clause-targeting)

---

## Feature 1: Fuzzy Matching

### Overview

Port the 3-tier progressive matching system from `reference_adeu` to handle real-world document variations (whitespace, smart quotes, placeholder patterns).

### Problem Statement

Current implementation uses exact string matching:

```javascript
const matchIndex = normalizedText.indexOf(normalizedSearch);
```

This fails when:
- Document has `"Hello"` (smart quotes) but search uses `"Hello"` (straight quotes)
- Document has `hello   world` (multiple spaces) but search uses `hello world`
- Document has `[__________]` placeholder but search uses `[___]`
- Markdown formatting markers exist between words

### Design

#### 3-Tier Matching Strategy

```
┌──────────────────────────────────────────────────────────────┐
│                      findTextFuzzy()                          │
├──────────────────────────────────────────────────────────────┤
│  Tier 1: Exact Match                                          │
│    └─► normalizedText.indexOf(normalizedSearch)               │
│         ↓ (if -1)                                             │
│  Tier 2: Smart Quote Normalization                            │
│    └─► Replace curly quotes with straight quotes, retry       │
│         ↓ (if -1)                                             │
│  Tier 3: Fuzzy Regex Match                                    │
│    └─► Build regex that tolerates:                            │
│        • Variable whitespace (\s+)                            │
│        • Variable underscores (_+)                            │
│        • Smart quote variants                                 │
│        • Markdown formatting markers (**, _, #)               │
└──────────────────────────────────────────────────────────────┘
```

#### New Files

```
superdoc-redlines/
├── src/
│   ├── fuzzyMatch.mjs        # NEW: Fuzzy matching module
│   └── textUtils.mjs         # NEW: Text normalization utilities
├── superdoc-redline.mjs      # MODIFY: Use fuzzy matching
└── tests/
    └── fuzzyMatch.test.mjs   # NEW: Fuzzy matching tests
```

### Implementation Details

#### File: `src/fuzzyMatch.mjs`

```javascript
/**
 * Fuzzy text matching module
 * Ported from reference_adeu/src/adeu/markup.py
 */

/**
 * Replace smart quotes with straight quotes (1:1 character mapping)
 * @param {string} text 
 * @returns {string}
 */
export function replaceSmartQuotes(text) {
  return text
    .replace(/"/g, '"')   // Left double quote
    .replace(/"/g, '"')   // Right double quote
    .replace(/'/g, "'")   // Left single quote
    .replace(/'/g, "'");  // Right single quote (apostrophe)
}

/**
 * Constructs a regex pattern that permits:
 * - Variable whitespace (\s+)
 * - Variable underscores (_+)
 * - Smart quote variation
 * - Intervening Markdown formatting (*, _, #)
 * 
 * @param {string} targetText - The text to search for
 * @returns {RegExp}
 */
export function makeFuzzyRegex(targetText) {
  // Normalize smart quotes first
  targetText = replaceSmartQuotes(targetText);
  
  const parts = [];
  
  // Tokenize: Underscores, Whitespace, Quotes
  const tokenPattern = /(_+)|(\s+)|(['"])/g;
  
  // Pattern to match markdown formatting noise (**, _, #, `)
  // Allows whitespace only if attached to formatting chars
  const markdownNoise = '(?:[\\*_#`]+[ \\t]*)*';
  
  // Allow noise at the very start (e.g. "**Word")
  parts.push(markdownNoise);
  
  let lastIdx = 0;
  let match;
  
  while ((match = tokenPattern.exec(targetText)) !== null) {
    // Escape literal text before the match
    const literal = targetText.slice(lastIdx, match.index);
    if (literal) {
      parts.push(escapeRegex(literal));
    }
    
    const [, gUnderscore, gSpace, gQuote] = match;
    
    // Insert noise handler BEFORE the separator
    parts.push(markdownNoise);
    
    if (gUnderscore) {
      // Variable underscores
      parts.push('_+');
    } else if (gSpace) {
      // Variable whitespace
      parts.push('\\s+');
    } else if (gQuote) {
      // Quote variants
      if (gQuote === "'") {
        parts.push("[''']");
      } else {
        parts.push('["\""""]');
      }
    }
    
    // Insert noise handler AFTER the separator
    parts.push(markdownNoise);
    
    lastIdx = match.index + match[0].length;
  }
  
  // Handle remaining literal text
  const remaining = targetText.slice(lastIdx);
  if (remaining) {
    parts.push(escapeRegex(remaining));
    parts.push(markdownNoise);
  }
  
  return new RegExp(parts.join(''));
}

/**
 * Escape special regex characters
 * @param {string} str 
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find target text in source text using progressive matching strategies.
 * 
 * @param {string} text - The source text to search in
 * @param {string} target - The target text to find
 * @returns {{ start: number, end: number, matchedText: string } | null}
 */
export function findTextFuzzy(text, target) {
  if (!target) {
    return null;
  }
  
  // Tier 1: Exact match
  let idx = text.indexOf(target);
  if (idx !== -1) {
    return { 
      start: idx, 
      end: idx + target.length, 
      matchedText: text.slice(idx, idx + target.length),
      tier: 'exact'
    };
  }
  
  // Tier 2: Smart quote normalization
  const normText = replaceSmartQuotes(text);
  const normTarget = replaceSmartQuotes(target);
  idx = normText.indexOf(normTarget);
  if (idx !== -1) {
    // Return position in ORIGINAL text (same indices since 1:1 replacement)
    return { 
      start: idx, 
      end: idx + target.length,
      matchedText: text.slice(idx, idx + target.length),
      tier: 'smartQuote'
    };
  }
  
  // Tier 3: Fuzzy regex match
  try {
    const pattern = makeFuzzyRegex(target);
    const match = pattern.exec(text);
    if (match) {
      return { 
        start: match.index, 
        end: match.index + match[0].length,
        matchedText: match[0],
        tier: 'fuzzy'
      };
    }
  } catch (e) {
    // Regex error - fall through to null
  }
  
  return null;
}
```

#### File: `src/textUtils.mjs`

```javascript
/**
 * Text normalization utilities
 */

/**
 * Normalize text by replacing non-breaking spaces with regular spaces.
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return text.replace(/\u00a0/g, ' ');
}

/**
 * Normalize all text for comparison:
 * - Non-breaking spaces → regular spaces
 * - Smart quotes → straight quotes
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return normalizeWhitespace(text)
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/'/g, "'");
}
```

#### Modifications to `superdoc-redline.mjs`

Replace the existing `findText` function:

```javascript
// OLD
function findText(editor, searchText) {
  const { segments, normalizedText } = buildTextIndex(editor.state.doc);
  const normalizedSearch = normalizeText(searchText);
  const matchIndex = normalizedText.indexOf(normalizedSearch);
  // ...
}

// NEW
import { findTextFuzzy } from './src/fuzzyMatch.mjs';

function findText(editor, searchText) {
  const { segments, normalizedText, rawText } = buildTextIndex(editor.state.doc);
  const normalizedSearch = normalizeText(searchText);
  
  // Use fuzzy matching
  const result = findTextFuzzy(normalizedText, normalizedSearch);
  
  if (!result) {
    return null;
  }
  
  // Convert string indices to ProseMirror positions
  const from = indexToPos(segments, result.start);
  const to = indexToPos(segments, result.end);
  
  if (from === null || to === null) {
    return null;
  }
  
  return { 
    from, 
    to, 
    matchedText: result.matchedText,
    matchTier: result.tier 
  };
}
```

### Testing Plan

```javascript
// tests/fuzzyMatch.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { findTextFuzzy, makeFuzzyRegex } from '../src/fuzzyMatch.mjs';

describe('Fuzzy Matching', () => {
  describe('Tier 1: Exact Match', () => {
    it('finds exact text', () => {
      const result = findTextFuzzy('The quick brown fox', 'quick');
      assert.strictEqual(result.start, 4);
      assert.strictEqual(result.end, 9);
      assert.strictEqual(result.tier, 'exact');
    });
  });

  describe('Tier 2: Smart Quote Normalization', () => {
    it('matches smart quotes with straight quotes', () => {
      const result = findTextFuzzy('"Hello" said the fox', '"Hello"');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.end, 7);
      assert.strictEqual(result.tier, 'smartQuote');
    });

    it('matches straight quotes with smart quotes', () => {
      const result = findTextFuzzy('"Hello" said the fox', '"Hello"');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.tier, 'smartQuote');
    });
  });

  describe('Tier 3: Fuzzy Regex Match', () => {
    it('matches variable whitespace', () => {
      const result = findTextFuzzy('hello   world', 'hello world');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.end, 13);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('matches variable underscores (placeholder)', () => {
      const result = findTextFuzzy('Sign here: [__________]', 'Sign here: [___]');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.tier, 'fuzzy');
    });

    it('ignores markdown formatting noise', () => {
      const result = findTextFuzzy('**Hello** world', 'Hello world');
      assert.ok(result);
      assert.strictEqual(result.tier, 'fuzzy');
    });
  });

  describe('No Match', () => {
    it('returns null when text not found', () => {
      const result = findTextFuzzy('The quick brown fox', 'elephant');
      assert.strictEqual(result, null);
    });
  });
});
```

### Edge Cases to Handle

1. **Empty target** → Return null
2. **Target longer than text** → Return null
3. **Regex special characters in target** → Escape them
4. **Unicode characters** → Preserve correctly
5. **Newlines in target** → Handle as whitespace variants

### Migration Notes

- This is a **non-breaking change** - exact matches still work
- Fuzzy matching is automatically tried when exact fails
- The `matchTier` field in response helps debugging
- Consider adding a `--strict` flag to disable fuzzy matching if needed

---

## Feature 2: Occurrence Selector

### Overview

Add ability to target specific occurrences of text (nth occurrence) or all occurrences, reducing agent burden when the same text appears multiple times.

### Problem Statement

Current implementation only finds the first occurrence:

```javascript
const matchIndex = normalizedText.indexOf(normalizedSearch);
```

This forces agents to:
1. Add surrounding context to disambiguate
2. Chunk documents manually to isolate occurrences
3. Process edits one-by-one when bulk updates are needed

### Design

#### New Edit Schema Fields

```json
{
  "find": "English law",
  "replace": "Singapore law",
  "occurrence": 2,        // NEW: Target 2nd occurrence (1-indexed)
  "comment": "Second reference"
}

{
  "find": "the Seller",
  "replace": "the Vendor", 
  "all": true,            // NEW: Replace ALL occurrences
  "comment": "Global terminology change"
}
```

#### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    processEdits()                            │
├─────────────────────────────────────────────────────────────┤
│  For each edit:                                              │
│    1. Find ALL matches using findAllMatches()                │
│    2. If edit.all === true:                                  │
│       └─► Queue ALL matches for processing                   │
│    3. Else if edit.occurrence defined:                       │
│       └─► Select nth match (1-indexed)                       │
│    4. Else:                                                  │
│       └─► Select first match (default behavior)              │
│    5. Process queued matches in reverse document order       │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Details

#### New Function: `findAllMatches()`

```javascript
/**
 * Find all occurrences of search text in the document.
 * 
 * @param {Object} editor - SuperDoc Editor instance
 * @param {string} searchText - Text to find
 * @param {Object} options - Search options
 * @param {boolean} options.fuzzy - Enable fuzzy matching (default: true)
 * @returns {Array<{ from: number, to: number, matchedText: string, index: number }>}
 */
function findAllMatches(editor, searchText, options = { fuzzy: true }) {
  const { segments, normalizedText } = buildTextIndex(editor.state.doc);
  const normalizedSearch = normalizeText(searchText);
  
  const matches = [];
  let searchStart = 0;
  let matchIndex = 0;
  
  while (true) {
    let result;
    
    if (options.fuzzy) {
      // Use fuzzy matching on remaining text
      const remainingText = normalizedText.slice(searchStart);
      result = findTextFuzzy(remainingText, normalizedSearch);
      if (result) {
        result.start += searchStart;
        result.end += searchStart;
      }
    } else {
      // Exact match only
      const idx = normalizedText.indexOf(normalizedSearch, searchStart);
      if (idx !== -1) {
        result = {
          start: idx,
          end: idx + normalizedSearch.length,
          matchedText: normalizedText.slice(idx, idx + normalizedSearch.length)
        };
      }
    }
    
    if (!result) break;
    
    const from = indexToPos(segments, result.start);
    const to = indexToPos(segments, result.end);
    
    if (from !== null && to !== null) {
      matches.push({
        from,
        to,
        matchedText: result.matchedText,
        occurrenceIndex: matchIndex++
      });
    }
    
    // Move search start past this match to find next
    searchStart = result.end;
  }
  
  return matches;
}
```

#### Modified `processEdits()` Function

```javascript
/**
 * Process all edits on the document.
 * @param {Object} editor - SuperDoc Editor instance
 * @param {Array} edits - Array of edit objects
 * @param {Object} author - Author info
 * @returns {{ applied: number, skipped: Array, comments: Array, details: Array }}
 */
function processEdits(editor, edits, author) {
  const results = { 
    applied: 0, 
    skipped: [], 
    comments: [],
    details: []  // NEW: Detailed per-edit results
  };

  // Collect all operations to apply
  const operations = [];

  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex];
    const { find, replace, comment, occurrence, all } = edit;
    
    // Find all matches
    const matches = findAllMatches(editor, find, { fuzzy: true });
    
    if (matches.length === 0) {
      results.skipped.push({ 
        index: editIndex, 
        find, 
        reason: 'Text not found',
        occurrencesFound: 0
      });
      continue;
    }
    
    // Determine which matches to process
    let selectedMatches;
    
    if (all === true) {
      // Process ALL occurrences
      selectedMatches = matches;
      results.details.push({
        index: editIndex,
        find,
        matchCount: matches.length,
        mode: 'all'
      });
    } else if (typeof occurrence === 'number') {
      // Process specific occurrence (1-indexed)
      if (occurrence < 1 || occurrence > matches.length) {
        results.skipped.push({
          index: editIndex,
          find,
          reason: `Occurrence ${occurrence} not found (only ${matches.length} occurrences exist)`,
          occurrencesFound: matches.length
        });
        continue;
      }
      selectedMatches = [matches[occurrence - 1]];
      results.details.push({
        index: editIndex,
        find,
        matchCount: 1,
        mode: `occurrence-${occurrence}`
      });
    } else {
      // Default: first occurrence
      selectedMatches = [matches[0]];
      results.details.push({
        index: editIndex,
        find,
        matchCount: 1,
        mode: 'first'
      });
    }
    
    // Queue operations
    for (const match of selectedMatches) {
      operations.push({
        editIndex,
        from: match.from,
        to: match.to,
        matchedText: match.matchedText,
        replace,
        comment,
        author
      });
    }
  }
  
  // Sort operations by position (descending) to avoid index shifting
  operations.sort((a, b) => b.from - a.from);
  
  // Apply operations
  for (const op of operations) {
    const { from, to, replace, comment, author, editIndex } = op;
    
    if (replace !== undefined) {
      applyReplacement(editor, from, to, replace);
      
      if (comment) {
        const newTo = from + replace.length;
        addComment(editor, from, newTo > from ? newTo : from + 1, comment, author, results.comments);
      }
    } else if (comment) {
      addComment(editor, from, to, comment, author, results.comments);
    }
    
    results.applied++;
  }
  
  return results;
}
```

#### CLI Schema Update

```javascript
// Update the edits schema in parseConfig()

/**
 * Edit object schema:
 * @property {string} find - Text to search for
 * @property {string} [replace] - Replacement text
 * @property {string} [comment] - Comment to add
 * @property {number} [occurrence] - Which occurrence to target (1-indexed)
 * @property {boolean} [all] - Replace all occurrences
 */
```

### Configuration Examples

```json
// edits.json

{
  "input": "contract.docx",
  "output": "redlined.docx",
  "author": { "name": "AI Assistant", "email": "ai@example.com" },
  "edits": [
    {
      "find": "the Seller",
      "replace": "the Vendor",
      "all": true,
      "comment": "Global: Standardize terminology"
    },
    {
      "find": "shall be governed by",
      "occurrence": 2,
      "comment": "Review: Second governing law clause"
    },
    {
      "find": "WHEREAS",
      "occurrence": 1,
      "replace": "RECITALS",
      "comment": "Update first recital heading only"
    }
  ]
}
```

### Output Schema Update

```json
{
  "success": true,
  "applied": 15,
  "skipped": [
    {
      "index": 2,
      "find": "nonexistent text",
      "reason": "Text not found",
      "occurrencesFound": 0
    }
  ],
  "details": [
    {
      "index": 0,
      "find": "the Seller",
      "matchCount": 12,
      "mode": "all"
    },
    {
      "index": 1,
      "find": "shall be governed by",
      "matchCount": 1,
      "mode": "occurrence-2"
    }
  ]
}
```

### Testing Plan

```javascript
// tests/occurrence.test.mjs

describe('Occurrence Selector', () => {
  describe('all: true', () => {
    it('replaces all occurrences', async () => {
      // Document: "The cat sat. The cat slept. The cat ate."
      // Edit: { find: "cat", replace: "dog", all: true }
      // Expected: "The dog sat. The dog slept. The dog ate."
    });
    
    it('reports correct match count', async () => {
      const result = await processDocument(config);
      assert.strictEqual(result.details[0].matchCount, 3);
      assert.strictEqual(result.details[0].mode, 'all');
    });
  });
  
  describe('occurrence: n', () => {
    it('replaces only nth occurrence (1-indexed)', async () => {
      // Document: "The cat sat. The cat slept. The cat ate."
      // Edit: { find: "cat", replace: "dog", occurrence: 2 }
      // Expected: "The cat sat. The dog slept. The cat ate."
    });
    
    it('skips if occurrence does not exist', async () => {
      // Document: "The cat sat."
      // Edit: { find: "cat", occurrence: 5 }
      // Expected: skipped with reason
    });
  });
  
  describe('default (first)', () => {
    it('replaces only first occurrence by default', async () => {
      // Document: "The cat sat. The cat slept."
      // Edit: { find: "cat", replace: "dog" }
      // Expected: "The dog sat. The cat slept."
    });
  });
});
```

### Edge Cases

1. **`all: true` with no matches** → Skip with `occurrencesFound: 0`
2. **`occurrence: 0`** → Error (must be 1-indexed)
3. **`occurrence` AND `all` both specified** → `all` takes precedence
4. **Overlapping matches** → Skip later matches that overlap earlier ones
5. **Same text, different edits** → Process in edit order, each sees remaining matches

---

## Feature 3: Word-Level Diff

### Overview

Enable "full rewrite" workflows where the agent provides the original and new text for a clause, and the library automatically computes minimal tracked changes.

### Reference Implementations Analyzed

| Library | Approach | Key Insight |
|---------|----------|-------------|
| `reference_adeu` | Word-level tokenization via `diff-match-patch` | Uses Python `diff_match_patch` with word encoding |
| `reference_office_word_diff` | Same algorithm, adapted for Office.js | Cascading fallback: Token → Sentence → Block |

### Design

#### New Edit Type: `diff`

```json
{
  "type": "diff",
  "originalText": "This Agreement shall be governed by English law.",
  "newText": "This Agreement shall be governed by Singapore law.",
  "comment": "Governing law change per Deal Context"
}
```

The library will:
1. Compute word-level diff between `originalText` and `newText`
2. Find `originalText` in the document
3. Apply the diff as granular tracked changes

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Word-Level Diff Pipeline                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: { originalText, newText }                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 1: Word-Level Tokenization                          │   │
│  │   • Split by: words (\w+), punctuation ([^\w\s]+),       │   │
│  │     whitespace (\s+)                                     │   │
│  │   • Encode tokens as Unicode chars (DMP line mode trick) │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 2: Compute Diff                                     │   │
│  │   • diff_main on encoded strings                         │   │
│  │   • Decode back to word tokens                           │   │
│  │   • Output: [[-1, "English "], [1, "Singapore "]]        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 3: Locate Original Text in Document                 │   │
│  │   • Use fuzzy matching to find originalText              │   │
│  │   • Build token map: word → ProseMirror position         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 4: Apply Changes                                    │   │
│  │   • Process deletions in reverse order                   │   │
│  │   • Process insertions at anchor positions               │   │
│  │   • Track changes mode active throughout                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Output: Tracked changes in document                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Details

#### New Dependency

```bash
npm install diff-match-patch
```

#### File: `src/wordDiff.mjs`

```javascript
/**
 * Word-level diff computation and application
 * 
 * Inspired by:
 * - reference_adeu/src/adeu/diff.py
 * - reference_office_word_diff/lib/diff-wordmode.js
 */

import DiffMatchPatch from 'diff-match-patch';

// Extend DiffMatchPatch with word-mode diff
const dmp = new DiffMatchPatch();

/**
 * Token regex - matches words, punctuation, and whitespace separately
 * This ensures tokens align 1:1 with how text appears in documents
 */
const TOKEN_REGEX = /(\w+|[^\w\s]+|\s+)/g;

/**
 * Tokenize text into words, punctuation, and whitespace
 * @param {string} text 
 * @returns {string[]}
 */
export function tokenize(text) {
  return text.match(TOKEN_REGEX) || [];
}

/**
 * Encode text as a string where each character represents a word/token
 * This is the "linesToChars" trick adapted for words
 * 
 * @param {string} text1 - Original text
 * @param {string} text2 - Modified text
 * @returns {{ chars1: string, chars2: string, tokenArray: string[] }}
 */
function wordsToChars(text1, text2) {
  const tokenArray = [''];  // Index 0 is empty (convention)
  const tokenHash = {};
  
  function encodeText(text) {
    const tokens = tokenize(text);
    let encoded = '';
    
    for (const token of tokens) {
      if (token in tokenHash) {
        encoded += String.fromCharCode(tokenHash[token]);
      } else {
        const code = tokenArray.length;
        tokenHash[token] = code;
        tokenArray.push(token);
        encoded += String.fromCharCode(code);
      }
    }
    
    return encoded;
  }
  
  const chars1 = encodeText(text1);
  const chars2 = encodeText(text2);
  
  return { chars1, chars2, tokenArray };
}

/**
 * Compute word-level diff between two texts
 * 
 * @param {string} text1 - Original text
 * @param {string} text2 - Modified text
 * @returns {Array<[number, string]>} - Array of [operation, text] tuples
 *   where operation is: 0 (equal), -1 (delete), 1 (insert)
 */
export function computeWordDiff(text1, text2) {
  const { chars1, chars2, tokenArray } = wordsToChars(text1, text2);
  
  // Compute diff on encoded strings
  const diffs = dmp.diff_main(chars1, chars2, false);
  
  // Apply semantic cleanup for better readability
  dmp.diff_cleanupSemantic(diffs);
  
  // Decode back to words
  dmp.diff_charsToLines_(diffs, tokenArray);
  
  return diffs;
}

/**
 * Get diff statistics
 * @param {string} text1 - Original text
 * @param {string} text2 - Modified text
 * @returns {{ insertions: number, deletions: number, unchanged: number }}
 */
export function getDiffStats(text1, text2) {
  const diffs = computeWordDiff(text1, text2);
  
  let insertions = 0;
  let deletions = 0;
  let unchanged = 0;
  
  for (const [op, text] of diffs) {
    const tokens = tokenize(text).length;
    if (op === 0) unchanged += tokens;
    else if (op === -1) deletions += tokens;
    else if (op === 1) insertions += tokens;
  }
  
  return { insertions, deletions, unchanged };
}

/**
 * Convert diff operations to structured edits
 * 
 * @param {string} originalText - The original text
 * @param {string} newText - The new text
 * @returns {Array<{ type: 'delete' | 'insert', position: number, text: string }>}
 */
export function diffToOperations(originalText, newText) {
  const diffs = computeWordDiff(originalText, newText);
  const operations = [];
  
  let originalIndex = 0;
  let pendingDelete = null;
  
  for (const [op, text] of diffs) {
    if (op === 0) {
      // Equal - flush pending delete
      if (pendingDelete) {
        operations.push(pendingDelete);
        pendingDelete = null;
      }
      originalIndex += text.length;
    } else if (op === -1) {
      // Delete - defer to check for immediate insert (merge into replace)
      pendingDelete = {
        type: 'delete',
        position: originalIndex,
        text: text
      };
      originalIndex += text.length;
    } else if (op === 1) {
      // Insert
      if (pendingDelete) {
        // Merge into replace operation
        operations.push({
          type: 'replace',
          position: pendingDelete.position,
          deleteText: pendingDelete.text,
          insertText: text
        });
        pendingDelete = null;
      } else {
        // Pure insert
        operations.push({
          type: 'insert',
          position: originalIndex,
          text: text
        });
      }
    }
  }
  
  // Flush trailing delete
  if (pendingDelete) {
    operations.push(pendingDelete);
  }
  
  return operations;
}
```

#### Integration with Main Module

```javascript
// superdoc-redline.mjs additions

import { computeWordDiff, diffToOperations, getDiffStats } from './src/wordDiff.mjs';

/**
 * Apply a diff-type edit
 * 
 * @param {Object} editor - SuperDoc Editor instance
 * @param {Object} edit - Diff edit object
 * @param {Object} author - Author info
 * @param {Array} commentsStore - Comments storage
 * @returns {{ success: boolean, stats: Object }}
 */
async function applyDiffEdit(editor, edit, author, commentsStore) {
  const { originalText, newText, comment } = edit;
  
  // Step 1: Find the original text in the document
  const matchResult = findText(editor, originalText);
  
  if (!matchResult) {
    return { 
      success: false, 
      reason: 'Original text not found in document',
      stats: null
    };
  }
  
  const { from: rangeStart, to: rangeEnd, matchedText } = matchResult;
  
  // Step 2: Compute word-level diff
  // Note: Use matchedText (actual doc text) vs newText for accurate diff
  const operations = diffToOperations(matchedText, newText);
  const stats = getDiffStats(matchedText, newText);
  
  // Step 3: Build token map for the matched range
  // Map each word in the matched range to its ProseMirror position
  const tokenMap = buildTokenMap(editor, rangeStart, rangeEnd);
  
  // Step 4: Apply operations in reverse order
  const sortedOps = operations
    .map((op, idx) => ({ ...op, idx }))
    .sort((a, b) => b.position - a.position);
  
  for (const op of sortedOps) {
    if (op.type === 'delete') {
      const from = tokenMap.positionAt(op.position);
      const to = tokenMap.positionAt(op.position + op.text.length);
      applyDeletion(editor, from, to);
    } else if (op.type === 'insert') {
      const at = tokenMap.positionAt(op.position);
      applyInsertion(editor, at, op.text);
    } else if (op.type === 'replace') {
      const from = tokenMap.positionAt(op.position);
      const to = tokenMap.positionAt(op.position + op.deleteText.length);
      applyReplacement(editor, from, to, op.insertText);
    }
  }
  
  // Step 5: Add comment if specified (spanning the whole edit range)
  if (comment) {
    const newEnd = rangeStart + newText.length;
    addComment(editor, rangeStart, newEnd, comment, author, commentsStore);
  }
  
  return { success: true, stats };
}

/**
 * Build a token map for a range in the document
 * Maps character positions to ProseMirror positions
 * 
 * @param {Object} editor 
 * @param {number} rangeStart - ProseMirror start position
 * @param {number} rangeEnd - ProseMirror end position
 * @returns {{ positionAt: (charIndex: number) => number }}
 */
function buildTokenMap(editor, rangeStart, rangeEnd) {
  const doc = editor.state.doc;
  const tokens = [];
  let charOffset = 0;
  
  // Walk through the document range
  doc.nodesBetween(rangeStart, rangeEnd, (node, pos) => {
    if (node.isText) {
      const text = node.text || '';
      const startInRange = Math.max(pos, rangeStart);
      const endInRange = Math.min(pos + text.length, rangeEnd);
      
      if (startInRange < endInRange) {
        const relativeStart = startInRange - rangeStart;
        const textSlice = text.slice(
          startInRange - pos,
          endInRange - pos
        );
        
        tokens.push({
          text: textSlice,
          pmPos: startInRange,
          charStart: charOffset,
          charEnd: charOffset + textSlice.length
        });
        
        charOffset += textSlice.length;
      }
    }
  });
  
  return {
    positionAt(charIndex) {
      for (const token of tokens) {
        if (charIndex >= token.charStart && charIndex <= token.charEnd) {
          const offset = charIndex - token.charStart;
          return token.pmPos + offset;
        }
      }
      // If at end, return last position
      if (tokens.length > 0) {
        const last = tokens[tokens.length - 1];
        return last.pmPos + last.text.length;
      }
      return rangeStart;
    }
  };
}
```

#### Updated Edit Schema

```javascript
// Edit types:
// 1. Standard find/replace
{
  "find": "English law",
  "replace": "Singapore law"
}

// 2. Diff mode (NEW)
{
  "type": "diff",
  "originalText": "The Seller shall deliver the Goods within 30 days.",
  "newText": "The Vendor shall deliver the Products within 14 business days.",
  "comment": "Updated terms per negotiation"
}
```

### Processing Logic

```javascript
function processEdits(editor, edits, author) {
  // ... existing code ...
  
  for (const edit of edits) {
    // Check edit type
    if (edit.type === 'diff') {
      // Use word-level diff
      const result = await applyDiffEdit(editor, edit, author, results.comments);
      if (result.success) {
        results.applied++;
        results.details.push({
          type: 'diff',
          stats: result.stats
        });
      } else {
        results.skipped.push({
          type: 'diff',
          originalText: edit.originalText.slice(0, 50) + '...',
          reason: result.reason
        });
      }
    } else {
      // Standard find/replace (existing logic)
      // ...
    }
  }
  
  return results;
}
```

### Testing Plan

```javascript
// tests/wordDiff.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeWordDiff, diffToOperations, getDiffStats } from '../src/wordDiff.mjs';

describe('Word-Level Diff', () => {
  describe('computeWordDiff', () => {
    it('detects single word change', () => {
      const diffs = computeWordDiff(
        'Hello world',
        'Hello there'
      );
      // Expect: [[0, 'Hello '], [-1, 'world'], [1, 'there']]
      assert.ok(diffs.some(d => d[0] === -1 && d[1] === 'world'));
      assert.ok(diffs.some(d => d[0] === 1 && d[1] === 'there'));
    });
    
    it('handles insertions', () => {
      const diffs = computeWordDiff(
        'Hello world',
        'Hello beautiful world'
      );
      assert.ok(diffs.some(d => d[0] === 1 && d[1].includes('beautiful')));
    });
    
    it('handles deletions', () => {
      const diffs = computeWordDiff(
        'Hello beautiful world',
        'Hello world'
      );
      assert.ok(diffs.some(d => d[0] === -1 && d[1].includes('beautiful')));
    });
    
    it('preserves punctuation as separate tokens', () => {
      const diffs = computeWordDiff(
        'Hello, world!',
        'Hello, there!'
      );
      // Punctuation should be preserved, only 'world' vs 'there' differs
    });
  });
  
  describe('diffToOperations', () => {
    it('converts to replace operation for adjacent delete+insert', () => {
      const ops = diffToOperations(
        'English law',
        'Singapore law'
      );
      assert.ok(ops.some(op => 
        op.type === 'replace' && 
        op.deleteText === 'English ' &&
        op.insertText === 'Singapore '
      ));
    });
  });
  
  describe('getDiffStats', () => {
    it('returns correct counts', () => {
      const stats = getDiffStats(
        'The quick brown fox',
        'The slow brown dog'
      );
      assert.strictEqual(stats.deletions, 2);  // 'quick', 'fox'
      assert.strictEqual(stats.insertions, 2); // 'slow', 'dog'
      assert.strictEqual(stats.unchanged, 2);  // 'The', 'brown'
    });
  });
});

describe('Integration: Diff Edit Application', () => {
  it('applies word-level changes to document', async () => {
    // Create test document with "This Agreement shall be governed by English law."
    // Apply diff edit to change to Singapore law
    // Verify tracked changes show only "English" deleted, "Singapore" inserted
  });
});
```

### Fallback Strategy

Following `reference_office_word_diff`'s pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                     Diff Application Cascade                 │
├─────────────────────────────────────────────────────────────┤
│  1. Word-Level Diff (granular tracked changes)               │
│        ↓ (if token mapping fails)                            │
│  2. Sentence-Level Diff (less granular, more robust)         │
│        ↓ (if sentence mapping fails)                         │
│  3. Block Replace (whole text replacement as single change)  │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature 4: Clause Targeting

### Overview

Enable agents to target document sections by clause heading/number, eliminating the need for manual document chunking and precise text quoting.

### Problem Statement

Agents currently must:
1. Extract exact text of a clause (error-prone)
2. Include sufficient context to disambiguate
3. Manually track clause boundaries
4. Handle nested numbering schemes

### Design

#### Clause Identification Strategies

| Strategy | Pattern | Example |
|----------|---------|---------|
| Numbered | `^\d+\.(\d+\.)*` | "1.", "1.1", "3.2.1" |
| Lettered | `^\([a-z]\)` | "(a)", "(b)", "(c)" |
| Roman | `^[ivxlcdm]+\.` | "i.", "ii.", "iv." |
| Named | Heading styles | "Definitions", "Warranties" |
| Combined | Number + Title | "3. DEFINITIONS" |

#### New Edit Types

```json
// Target by clause number
{
  "type": "clause",
  "clauseNumber": "3.2",
  "replace": "New clause text...",
  "comment": "Rewrote warranties clause"
}

// Target by clause heading
{
  "type": "clause",
  "clauseHeading": "Definitions",
  "delete": true,
  "comment": "Removed definitions section"
}

// Insert new clause
{
  "type": "clause",
  "insertAfter": "2.1",
  "newClauseNumber": "2.2",
  "text": "New clause content...",
  "comment": "Added new payment terms"
}
```

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Clause Targeting Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 1: Document Structure Extraction                    │   │
│  │   • Walk ProseMirror doc to identify paragraphs          │   │
│  │   • Detect heading styles / outline levels               │   │
│  │   • Parse clause numbers from paragraph starts           │   │
│  │   • Build hierarchical clause tree                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 2: Clause Boundary Detection                        │   │
│  │   • For each clause, determine start/end positions       │   │
│  │   • End = start of next sibling/parent clause            │   │
│  │   • Handle nested clauses (3.1 inside 3)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 3: Clause Resolution                                │   │
│  │   • Match user query to clause (by number or heading)    │   │
│  │   • Return ProseMirror position range                    │   │
│  │   • Option: includeSubclauses (true/false)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 4: Apply Edit                                       │   │
│  │   • Replace: Delete range, insert new text               │   │
│  │   • Delete: Delete range                                 │   │
│  │   • Insert: Find anchor clause, insert after             │   │
│  │   • Diff: Use word-level diff on clause text             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Details

#### File: `src/clauseParser.mjs`

```javascript
/**
 * Clause parsing and targeting module
 */

/**
 * Clause numbering patterns
 */
const CLAUSE_PATTERNS = {
  // Standard numbered: 1., 1.1, 1.1.1
  numbered: /^(\d+(?:\.\d+)*)\.\s*/,
  
  // Lettered: (a), (b), (c)
  lettered: /^\(([a-z])\)\s*/i,
  
  // Roman numerals: i., ii., iii.
  roman: /^([ivxlcdm]+)\.\s*/i,
  
  // Bracketed numbers: [1], [2]
  bracketed: /^\[(\d+)\]\s*/,
  
  // Article style: Article 1, Article I
  article: /^Article\s+(\d+|[IVXLCDM]+)/i,
  
  // Schedule/Exhibit: Schedule 1, Exhibit A
  schedule: /^(Schedule|Exhibit|Appendix|Annex)\s+(\d+|[A-Z])/i
};

/**
 * Represents a clause in the document structure
 */
class Clause {
  constructor(options) {
    this.number = options.number;           // e.g., "3.2"
    this.heading = options.heading;         // e.g., "Warranties"
    this.level = options.level;             // Nesting depth
    this.startPos = options.startPos;       // ProseMirror start position
    this.endPos = options.endPos;           // ProseMirror end position (exclusive)
    this.text = options.text;               // Full clause text
    this.children = [];                     // Sub-clauses
    this.parent = null;                     // Parent clause
  }
  
  get fullNumber() {
    if (this.parent) {
      return `${this.parent.fullNumber}.${this.number}`;
    }
    return this.number;
  }
}

/**
 * Parse clause number from paragraph text
 * 
 * @param {string} text - Paragraph text
 * @returns {{ type: string, number: string, remainder: string } | null}
 */
export function parseClauseNumber(text) {
  text = text.trim();
  
  for (const [type, pattern] of Object.entries(CLAUSE_PATTERNS)) {
    const match = pattern.exec(text);
    if (match) {
      return {
        type,
        number: match[1],
        remainder: text.slice(match[0].length).trim()
      };
    }
  }
  
  return null;
}

/**
 * Determine if a paragraph is a heading based on style or content
 * 
 * @param {Object} node - ProseMirror paragraph node
 * @param {string} text - Paragraph text
 * @returns {{ isHeading: boolean, level: number, title: string }}
 */
export function analyzeHeading(node, text) {
  // Check for Heading style marks/attributes
  const style = node.attrs?.style || '';
  const headingMatch = style.match(/Heading\s*(\d+)/i);
  
  if (headingMatch) {
    return {
      isHeading: true,
      level: parseInt(headingMatch[1], 10),
      title: text.trim()
    };
  }
  
  // Heuristic: ALL CAPS short text is likely a heading
  if (text.length < 100 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return {
      isHeading: true,
      level: 1,  // Assume top-level
      title: text.trim()
    };
  }
  
  return { isHeading: false, level: 0, title: '' };
}

/**
 * Build clause structure from ProseMirror document
 * 
 * @param {Object} doc - ProseMirror document
 * @returns {{ clauses: Clause[], index: Map<string, Clause> }}
 */
export function buildClauseStructure(doc) {
  const clauses = [];
  const index = new Map();  // Quick lookup by number or heading
  const stack = [];         // Stack for building hierarchy
  
  let currentPos = 0;
  
  doc.forEach((node, offset) => {
    const nodeStart = offset;
    const nodeEnd = offset + node.nodeSize;
    
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      const text = node.textContent;
      const parsed = parseClauseNumber(text);
      const headingInfo = analyzeHeading(node, text);
      
      if (parsed || headingInfo.isHeading) {
        // Determine clause level
        let level = 1;
        if (parsed) {
          // Count dots in number for level: "3.2.1" = level 3
          level = (parsed.number.match(/\./g) || []).length + 1;
        } else if (headingInfo.isHeading) {
          level = headingInfo.level;
        }
        
        // Create clause
        const clause = new Clause({
          number: parsed?.number || null,
          heading: headingInfo.title || parsed?.remainder?.split('\n')[0] || null,
          level,
          startPos: nodeStart,
          endPos: nodeEnd,  // Will be updated when next clause found
          text: text
        });
        
        // Update parent's end position
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          const popped = stack.pop();
          popped.endPos = nodeStart;
        }
        
        // Set parent relationship
        if (stack.length > 0) {
          clause.parent = stack[stack.length - 1];
          stack[stack.length - 1].children.push(clause);
        } else {
          clauses.push(clause);
        }
        
        stack.push(clause);
        
        // Index by number and heading
        if (clause.number) {
          index.set(clause.number, clause);
          index.set(clause.fullNumber, clause);
        }
        if (clause.heading) {
          index.set(clause.heading.toLowerCase(), clause);
        }
      }
    }
  });
  
  // Finalize end positions for remaining stack items
  const docEnd = doc.content.size;
  while (stack.length > 0) {
    stack.pop().endPos = docEnd;
  }
  
  return { clauses, index };
}

/**
 * Find a clause by number or heading
 * 
 * @param {Map<string, Clause>} index - Clause index
 * @param {Object} query - Query parameters
 * @param {string} [query.number] - Clause number (e.g., "3.2")
 * @param {string} [query.heading] - Clause heading (e.g., "Definitions")
 * @returns {Clause | null}
 */
export function findClause(index, query) {
  if (query.number) {
    return index.get(query.number) || null;
  }
  
  if (query.heading) {
    // Try exact match first
    const exactKey = query.heading.toLowerCase();
    if (index.has(exactKey)) {
      return index.get(exactKey);
    }
    
    // Try fuzzy heading match
    for (const [key, clause] of index) {
      if (typeof key === 'string' && key.toLowerCase().includes(exactKey)) {
        return clause;
      }
    }
  }
  
  return null;
}

/**
 * Get the full range of a clause including its sub-clauses
 * 
 * @param {Clause} clause 
 * @param {boolean} includeSubclauses - Whether to include nested clauses
 * @returns {{ from: number, to: number }}
 */
export function getClauseRange(clause, includeSubclauses = true) {
  if (includeSubclauses) {
    return { from: clause.startPos, to: clause.endPos };
  }
  
  // Find end before first child
  if (clause.children.length > 0) {
    return { from: clause.startPos, to: clause.children[0].startPos };
  }
  
  return { from: clause.startPos, to: clause.endPos };
}

/**
 * Extract clause text from document
 * 
 * @param {Object} doc - ProseMirror document
 * @param {Clause} clause 
 * @param {boolean} includeSubclauses 
 * @returns {string}
 */
export function extractClauseText(doc, clause, includeSubclauses = true) {
  const { from, to } = getClauseRange(clause, includeSubclauses);
  return doc.textBetween(from, to, '\n');
}
```

#### Integration: Clause Edit Processing

```javascript
// superdoc-redline.mjs additions

import { 
  buildClauseStructure, 
  findClause, 
  getClauseRange,
  extractClauseText 
} from './src/clauseParser.mjs';

/**
 * Apply a clause-type edit
 */
async function applyClauseEdit(editor, edit, author, commentsStore) {
  const doc = editor.state.doc;
  
  // Build clause structure (could cache this)
  const { index } = buildClauseStructure(doc);
  
  // Find target clause
  const clause = findClause(index, {
    number: edit.clauseNumber,
    heading: edit.clauseHeading
  });
  
  if (!clause) {
    return {
      success: false,
      reason: `Clause not found: ${edit.clauseNumber || edit.clauseHeading}`
    };
  }
  
  const includeSubclauses = edit.includeSubclauses !== false;
  const { from, to } = getClauseRange(clause, includeSubclauses);
  
  // Handle different operations
  if (edit.delete === true) {
    // Delete entire clause
    const tr = editor.state.tr.delete(from, to);
    dispatchTransaction(editor, tr);
    
    if (edit.comment) {
      // Comment on deletion is tricky - attach to preceding text?
    }
    
    return { success: true, operation: 'delete' };
  }
  
  if (edit.replace) {
    // Replace clause content
    const currentText = extractClauseText(doc, clause, includeSubclauses);
    
    if (edit.diff === true) {
      // Use word-level diff
      return await applyDiffEdit(editor, {
        originalText: currentText,
        newText: edit.replace,
        comment: edit.comment
      }, author, commentsStore);
    } else {
      // Full replacement
      applyReplacement(editor, from, to, edit.replace);
      
      if (edit.comment) {
        const newEnd = from + edit.replace.length;
        addComment(editor, from, newEnd, edit.comment, author, commentsStore);
      }
      
      return { success: true, operation: 'replace' };
    }
  }
  
  if (edit.insertAfter) {
    // Insert new clause after this one
    const insertPos = to;
    const newText = `\n\n${edit.newClauseNumber || ''} ${edit.text}`;
    
    const tr = editor.state.tr.insertText(newText, insertPos);
    dispatchTransaction(editor, tr);
    
    if (edit.comment) {
      addComment(editor, insertPos, insertPos + newText.length, edit.comment, author, commentsStore);
    }
    
    return { success: true, operation: 'insert' };
  }
  
  // Comment-only on clause
  if (edit.comment && !edit.replace && !edit.delete) {
    addComment(editor, from, to, edit.comment, author, commentsStore);
    return { success: true, operation: 'comment' };
  }
  
  return { success: false, reason: 'No valid operation specified' };
}
```

### Configuration Examples

```json
{
  "input": "asset_purchase_agreement.docx",
  "output": "redlined.docx",
  "author": { "name": "Deal Counsel", "email": "counsel@firm.com" },
  "edits": [
    {
      "type": "clause",
      "clauseNumber": "1",
      "clauseHeading": "Definitions",
      "comment": "Review all defined terms for Singapore context"
    },
    {
      "type": "clause",
      "clauseNumber": "7.2",
      "replace": "7.2 Governing Law\n\nThis Agreement shall be governed by and construed in accordance with the laws of Singapore.",
      "diff": true,
      "comment": "Changed from English law to Singapore law"
    },
    {
      "type": "clause",
      "clauseHeading": "TUPE",
      "delete": true,
      "comment": "Deleted: Singapore has no TUPE equivalent"
    },
    {
      "type": "clause",
      "insertAfter": "3.1",
      "newClauseNumber": "3.2",
      "text": "Condition Precedent\n\nCompletion is conditional upon [regulatory approval].",
      "comment": "Added new condition precedent"
    },
    {
      "type": "clause",
      "clauseNumber": "5",
      "includeSubclauses": false,
      "replace": "5. WARRANTIES\n\nThe Seller warrants to the Buyer as follows:",
      "comment": "Updated main clause heading only, subclauses unchanged"
    }
  ]
}
```

### Output Enhancement: Clause Summary

```json
{
  "success": true,
  "applied": 5,
  "clauseStructure": {
    "detected": 47,
    "topLevel": 12,
    "targeted": [
      { "number": "1", "heading": "Definitions", "operation": "comment" },
      { "number": "7.2", "heading": "Governing Law", "operation": "replace-diff" },
      { "number": "8.4", "heading": "TUPE", "operation": "delete" }
    ]
  }
}
```

### Testing Plan

```javascript
// tests/clauseParser.test.mjs

describe('Clause Parser', () => {
  describe('parseClauseNumber', () => {
    it('parses simple numbered clauses', () => {
      assert.deepStrictEqual(
        parseClauseNumber('1. Definitions'),
        { type: 'numbered', number: '1', remainder: 'Definitions' }
      );
    });
    
    it('parses nested numbered clauses', () => {
      assert.deepStrictEqual(
        parseClauseNumber('3.2.1 Sub-sub-clause'),
        { type: 'numbered', number: '3.2.1', remainder: 'Sub-sub-clause' }
      );
    });
    
    it('parses lettered clauses', () => {
      assert.deepStrictEqual(
        parseClauseNumber('(a) First item'),
        { type: 'lettered', number: 'a', remainder: 'First item' }
      );
    });
    
    it('parses Article-style clauses', () => {
      assert.deepStrictEqual(
        parseClauseNumber('Article 5 - Warranties'),
        { type: 'article', number: '5', remainder: '- Warranties' }
      );
    });
  });
  
  describe('buildClauseStructure', () => {
    it('builds hierarchical clause tree', async () => {
      // Create doc with:
      // 1. First Clause
      //   1.1 Sub-clause
      //   1.2 Another sub-clause
      // 2. Second Clause
      
      const { clauses, index } = buildClauseStructure(doc);
      
      assert.strictEqual(clauses.length, 2);
      assert.strictEqual(clauses[0].children.length, 2);
      assert.ok(index.has('1.1'));
    });
  });
  
  describe('findClause', () => {
    it('finds by exact number', () => {
      const clause = findClause(index, { number: '3.2' });
      assert.strictEqual(clause.number, '3.2');
    });
    
    it('finds by heading (case-insensitive)', () => {
      const clause = findClause(index, { heading: 'definitions' });
      assert.strictEqual(clause.heading, 'Definitions');
    });
    
    it('finds by partial heading match', () => {
      const clause = findClause(index, { heading: 'govern' });
      assert.ok(clause.heading.toLowerCase().includes('governing'));
    });
  });
});

describe('Clause Edit Application', () => {
  it('replaces entire clause with tracked changes', async () => {
    // Test replacing clause 3.2 entirely
  });
  
  it('replaces clause using word-level diff', async () => {
    // Test diff:true option for minimal changes
  });
  
  it('deletes clause', async () => {
    // Test delete:true
  });
  
  it('inserts new clause after specified clause', async () => {
    // Test insertAfter
  });
  
  it('handles includeSubclauses option', async () => {
    // Test replacing only parent, leaving children
  });
});
```

### Edge Cases

1. **Multiple clauses with same heading** → Use first match, or require number
2. **Malformed numbering** (1. then 3.) → Build structure as-is
3. **No clause structure detected** → Return error with helpful message
4. **Clause spans multiple pages** → Handle correctly (ProseMirror is page-agnostic)
5. **Schedules/Exhibits** → Treat as top-level sections with separate numbering
6. **Tables within clauses** → Include in clause range

---

## Implementation Priority

| Priority | Feature | Complexity | Agent Benefit |
|----------|---------|------------|---------------|
| 1 | Fuzzy Matching | Medium | High - Fixes most "not found" errors |
| 2 | Word-Level Diff | High | Very High - Enables "rewrite clause" workflow |
| 3 | Occurrence Selector | Low | Medium - Enables bulk terminology updates |
| 4 | Clause Targeting | High | Very High - Eliminates chunking entirely |

## Recommended Implementation Order

1. **Week 1**: Fuzzy Matching + Occurrence Selector
   - These are lower complexity and immediately useful
   - Can be implemented together as they both enhance `findText`

2. **Week 2-3**: Word-Level Diff
   - Core algorithm ported from references
   - Integration with existing edit pipeline
   - Comprehensive testing

3. **Week 3-4**: Clause Targeting
   - Requires document structure analysis
   - Most transformative for agent workflows
   - Benefits from Fuzzy Matching and Word-Level Diff being in place

---

## Appendix: Reference Implementation Comparison

### Fuzzy Matching

| Feature | reference_adeu | reference_office_word_diff | Plan |
|---------|---------------|---------------------------|------|
| Smart quotes | ✅ | ❌ | ✅ |
| Variable whitespace | ✅ | ❌ | ✅ |
| Variable underscores | ✅ | ❌ | ✅ |
| Markdown noise | ✅ | ❌ | ✅ |

### Word-Level Diff

| Feature | reference_adeu | reference_office_word_diff | Plan |
|---------|---------------|---------------------------|------|
| diff-match-patch | ✅ | ✅ | ✅ |
| Word tokenization | Custom regex | `/(\w+\|[^\w\s]+\|\s+)/g` | Same regex |
| Semantic cleanup | ✅ | ❌ (disabled) | Optional |
| Cascading fallback | ❌ | Token→Sentence→Block | Simplified |

### Clause Targeting

| Feature | reference_adeu | reference_office_word_diff | Plan |
|---------|---------------|---------------------------|------|
| Clause detection | ❌ | ❌ | ✅ (NEW) |
| Heading styles | ✅ (Markdown headers) | ❌ | ✅ |
| Hierarchy tracking | ❌ | ❌ | ✅ (NEW) |
