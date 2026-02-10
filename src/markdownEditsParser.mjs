/**
 * Markdown Edits Parser - Parse and generate markdown edit format.
 *
 * This module provides bidirectional conversion between markdown-formatted
 * edit instructions and JSON edit structures used by the edit system.
 *
 * Key Features:
 * - Parse markdown edit format into JSON edit structure
 * - Convert JSON edits back to markdown format
 * - Handle all operation types: delete, replace, comment, insert
 * - Graceful error handling for malformed input
 * - Support for partial recovery from truncated output
 */

/**
 * @typedef {Object} Author
 * @property {string} name - Author's name
 * @property {string} email - Author's email
 */

/**
 * @typedef {Object} Edit
 * @property {string} [blockId] - Block ID for delete, replace, comment operations
 * @property {string} [afterBlockId] - Block ID for insert operations (insert after this block)
 * @property {'delete'|'replace'|'comment'|'insert'} operation - Operation type
 * @property {boolean} [diff] - Word-level diff mode (for replace only)
 * @property {string} [comment] - Rationale for edit
 * @property {string} [newText] - Replacement text (for replace only)
 * @property {string} [text] - Insert text (for insert only)
 */

/**
 * @typedef {Object} ParsedEdits
 * @property {string} version - Version string
 * @property {Author} author - Author information
 * @property {Edit[]} edits - Array of parsed edits
 */

/**
 * Parse markdown edit format into JSON edit structure.
 *
 * @param {string} markdown - Markdown formatted edit instructions
 * @returns {ParsedEdits} Parsed edit structure
 */
export function parseMarkdownEdits(markdown) {
  const result = {
    version: '',
    author: { name: '', email: '' },
    edits: []
  };

  if (!markdown || typeof markdown !== 'string') {
    return result;
  }

  // Parse metadata section
  const versionMatch = markdown.match(/\*\*Version\*\*:\s*(.+)/i);
  if (versionMatch) {
    result.version = versionMatch[1].trim();
  }

  const authorNameMatch = markdown.match(/\*\*Author Name\*\*:\s*(.+)/i);
  if (authorNameMatch) {
    result.author.name = authorNameMatch[1].trim();
  }

  const authorEmailMatch = markdown.match(/\*\*Author Email\*\*:\s*(.+)/i);
  if (authorEmailMatch) {
    result.author.email = authorEmailMatch[1].trim();
  }

  // Parse replacement/insert text sections first so we can reference them later
  const textSections = new Map();
  // FIXED: Also stop at ## headings to prevent trailing content (like "## Notes") from being
  // included in the last edit's newText. The lookahead now stops at:
  // - Another ### b### newText/insertText section
  // - A ## heading (any level 2 heading)
  // - End of string
  const textSectionRegex = /###\s+(b\d+)\s+(newText|insertText)\s*\n([\s\S]*?)(?=(?:\n###\s+b\d+\s+(?:newText|insertText))|\n##\s|$)/gi;
  let textMatch;
  while ((textMatch = textSectionRegex.exec(markdown)) !== null) {
    const blockId = textMatch[1];
    const textType = textMatch[2].toLowerCase();
    const textContent = textMatch[3].trim();
    textSections.set(`${blockId}_${textType}`, textContent);
  }

  // Find and parse the edits table (supports both 4-column v0.2.0 and 6-column v0.3.0 format)
  const tableMatch = markdown.match(/\|\s*Block\s*\|\s*Op\s*\|\s*(?:FindText\s*\|\s*Color\s*\|\s*)?Diff\s*\|\s*Comment[\s\S]*?(?=\n##|\n###|$)/i);
  if (!tableMatch) {
    return result;
  }

  const tableContent = tableMatch[0];
  const tableLines = tableContent.split('\n').filter(line => line.trim());

  // Skip header and separator rows
  let dataStartIndex = 0;
  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i].trim();
    // Skip header row
    if (/^\|\s*Block\s*\|/i.test(line)) {
      dataStartIndex = i + 1;
      continue;
    }
    // Skip separator row (contains dashes)
    if (/^\|[\s\-|]+\|$/.test(line)) {
      dataStartIndex = i + 1;
      continue;
    }
  }

  // Parse data rows
  for (let i = dataStartIndex; i < tableLines.length; i++) {
    const line = tableLines[i].trim();

    // Skip empty lines or lines that don't look like table rows
    if (!line || !line.startsWith('|')) {
      continue;
    }

    try {
      const edit = parseTableRow(line, textSections);
      if (edit) {
        result.edits.push(edit);
      }
    } catch (err) {
      console.warn(`Skipping malformed row: ${line} - ${err.message}`);
    }
  }

  return result;
}

/**
 * Parse a single table row into an edit object.
 *
 * @param {string} line - Table row line
 * @param {Map<string, string>} textSections - Map of block text sections
 * @returns {Edit|null} Parsed edit or null if invalid
 */
function parseTableRow(line, textSections) {
  // Split by | and filter empty parts
  const parts = line.split('|').map(p => p.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1 || arr.length <= 2);

  // Handle edge case where line ends with |
  const cells = line.split('|');
  const cleanCells = [];
  for (let i = 1; i < cells.length; i++) {
    if (i === cells.length - 1 && cells[i].trim() === '') {
      continue; // Skip trailing empty cell after final |
    }
    cleanCells.push(cells[i].trim());
  }

  if (cleanCells.length < 2) {
    return null;
  }

  // Detect format: 6-column (v0.3.0) vs 4-column (v0.2.0)
  // 4-column: Block | Op | Diff | Comment
  // 6-column: Block | Op | FindText | Color | Diff | Comment/InsertText
  let blockId, operation, findTextValue, colorValue, diffValue, comment;

  if (cleanCells.length >= 6) {
    // 6-column format (v0.3.0)
    blockId = cleanCells[0];
    operation = cleanCells[1]?.toLowerCase();
    findTextValue = cleanCells[2] || '-';
    colorValue = cleanCells[3] || '-';
    diffValue = cleanCells[4] || '-';
    comment = cleanCells[5] || '';
  } else {
    // 4-column format (v0.2.0)
    blockId = cleanCells[0];
    operation = cleanCells[1]?.toLowerCase();
    diffValue = cleanCells[2] || '-';
    comment = cleanCells[3] || '';
    findTextValue = '-';
    colorValue = '-';
  }

  // Validate block ID format
  if (!blockId || !/^b\d+$/i.test(blockId)) {
    console.warn(`Invalid block ID: ${blockId}`);
    return null;
  }

  // Validate operation
  const validOps = ['delete', 'replace', 'comment', 'insert', 'insertaftertext', 'highlight', 'commentrange', 'commenthighlight'];
  if (!operation || !validOps.includes(operation)) {
    console.warn(`Invalid operation: ${operation}`);
    return null;
  }

  // Normalize operation casing for camelCase operations
  const opMap = {
    'insertaftertext': 'insertAfterText',
    'commentrange': 'commentRange',
    'commenthighlight': 'commentHighlight'
  };
  const normalizedOp = opMap[operation] || operation;

  const edit = {
    operation: normalizedOp
  };

  // Handle insert operation - uses afterBlockId instead of blockId
  if (normalizedOp === 'insert') {
    edit.afterBlockId = blockId;
  } else {
    edit.blockId = blockId;
  }

  // Parse findText
  if (findTextValue && findTextValue !== '-') {
    edit.findText = findTextValue;
  }

  // Parse color
  if (colorValue && colorValue !== '-') {
    edit.color = colorValue;
  }

  // Parse diff value for replace operations
  if (normalizedOp === 'replace') {
    if (diffValue.toLowerCase() === 'true') {
      edit.diff = true;
    } else if (diffValue.toLowerCase() === 'false') {
      edit.diff = false;
    }
  }

  // Add comment if present
  if (comment && comment !== '-') {
    // For insertAfterText, the comment column maps to insertText
    if (normalizedOp === 'insertAfterText') {
      edit.insertText = comment;
    } else {
      edit.comment = comment;
    }
  }

  // Look up associated text for replace and insert operations
  if (normalizedOp === 'replace') {
    const newText = textSections.get(`${blockId}_newtext`);
    if (newText) {
      edit.newText = newText;
    } else {
      console.warn(`Missing newText section for replace operation on ${blockId}`);
    }
  } else if (normalizedOp === 'insert') {
    const insertText = textSections.get(`${blockId}_inserttext`);
    if (insertText) {
      edit.text = insertText;
    } else {
      console.warn(`Missing insertText section for insert operation on ${blockId}`);
    }
  }

  return edit;
}

/**
 * Convert JSON edits back to markdown format.
 *
 * @param {ParsedEdits} json - JSON edit structure
 * @returns {string} Markdown formatted edit instructions
 */
export function editsToMarkdown(json) {
  if (!json || typeof json !== 'object') {
    return '';
  }

  const lines = [];

  // Document title
  lines.push('# Edits');
  lines.push('');

  // Metadata section
  lines.push('## Metadata');
  if (json.version) {
    lines.push(`- **Version**: ${json.version}`);
  }
  if (json.author?.name) {
    lines.push(`- **Author Name**: ${json.author.name}`);
  }
  if (json.author?.email) {
    lines.push(`- **Author Email**: ${json.author.email}`);
  }
  lines.push('');

  // Edits table section
  lines.push('## Edits Table');
  lines.push('');

  const edits = json.edits || [];
  const textSections = [];

  // Detect if we need the extended 6-column format
  const newOps = ['insertAfterText', 'highlight', 'commentRange', 'commentHighlight'];
  const hasNewOps = edits.some(e =>
    newOps.includes(e.operation) ||
    (e.operation === 'comment' && e.findText) ||
    e.findText || e.color
  );

  if (hasNewOps) {
    lines.push('| Block | Op | FindText | Color | Diff | Comment |');
    lines.push('|-------|-----|----------|-------|------|---------|');
  } else {
    lines.push('| Block | Op | Diff | Comment |');
    lines.push('|-------|-----|------|---------|');
  }

  for (const edit of edits) {
    const blockId = edit.blockId || edit.afterBlockId || '';
    const operation = edit.operation || '';

    // Determine diff value
    let diffValue = '-';
    if (operation === 'replace') {
      if (edit.diff === true) {
        diffValue = 'true';
      } else if (edit.diff === false) {
        diffValue = 'false';
      }
    }

    if (hasNewOps) {
      const findText = edit.findText || '-';
      const color = edit.color || '-';
      // For insertAfterText, put insertText in the comment column
      const commentCol = operation === 'insertAfterText'
        ? (edit.insertText || '-')
        : (edit.comment || '-');

      lines.push(`| ${blockId} | ${operation} | ${findText} | ${color} | ${diffValue} | ${commentCol} |`);
    } else {
      const comment = edit.comment || '-';
      lines.push(`| ${blockId} | ${operation} | ${diffValue} | ${comment} |`);
    }

    // Collect text sections for later
    if (operation === 'replace' && edit.newText) {
      textSections.push({
        blockId,
        type: 'newText',
        content: edit.newText
      });
    } else if (operation === 'insert' && edit.text) {
      textSections.push({
        blockId,
        type: 'insertText',
        content: edit.text
      });
    }
  }

  // Add replacement/insert text sections
  if (textSections.length > 0) {
    lines.push('');
    lines.push('## Replacement Text');

    for (const section of textSections) {
      lines.push('');
      lines.push(`### ${section.blockId} ${section.type}`);
      lines.push(section.content);
    }
  }

  return lines.join('\n');
}
