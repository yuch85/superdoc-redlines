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
