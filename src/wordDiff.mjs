/**
 * Word-level diff computation and application
 *
 * Inspired by:
 * - reference_adeu/src/adeu/diff.py
 * - reference_office_word_diff/lib/diff-wordmode.js
 */

import DiffMatchPatch from 'diff-match-patch';

// Create DMP instance
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
 * @returns {Array<{ type: 'delete' | 'insert' | 'replace', position: number, text?: string, deleteText?: string, insertText?: string }>}
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
