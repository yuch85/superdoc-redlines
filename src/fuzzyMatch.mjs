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
    .replace(/\u201C/g, '"')   // Left double quote "
    .replace(/\u201D/g, '"')   // Right double quote "
    .replace(/\u2018/g, "'")   // Left single quote '
    .replace(/\u2019/g, "'");  // Right single quote '
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
      // Quote variants - use Unicode escapes for smart quotes
      if (gQuote === "'") {
        parts.push("['\u2018\u2019]");  // single quote variants
      } else {
        parts.push('["\u201C\u201D]');  // double quote variants
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
 * Find target text in source text using progressive matching strategies.
 *
 * @param {string} text - The source text to search in
 * @param {string} target - The target text to find
 * @returns {{ start: number, end: number, matchedText: string, tier: string } | null}
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
