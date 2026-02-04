/**
 * IR Extractor - Extracts structured intermediate representation from DOCX files.
 *
 * This module transforms DOCX documents into a JSON format with stable block IDs,
 * enabling LLMs to reference and edit specific document sections deterministically.
 */
import { createHeadlessEditor } from './editorFactory.mjs';
import { createIdManager } from './idManager.mjs';
import { parseClauseNumber, analyzeHeading } from './clauseParser.mjs';
import { readFile } from 'fs/promises';

/**
 * Extract structured intermediate representation from a DOCX file.
 *
 * @param {string} inputPath - Path to input DOCX file
 * @param {ExtractOptions} options - Extraction options
 * @returns {Promise<DocumentIR>} - Structured document representation
 *
 * @typedef {Object} ExtractOptions
 * @property {'full'|'outline'|'blocks'} format - Output format
 *   - 'full': Complete IR with all metadata
 *   - 'outline': Headings and structure only (for navigation)
 *   - 'blocks': Flat list of blocks (for simple documents)
 * @property {boolean} includeDefinedTerms - Extract defined terms (default: true)
 * @property {boolean} includeOutline - Build hierarchical outline (default: true)
 * @property {number} maxTextLength - Truncate block text (default: null = no truncation)
 * @property {boolean} assignNewIds - Force new ID assignment (default: false)
 */
export async function extractDocumentIR(inputPath, options = {}) {
  const {
    format = 'full',
    includeDefinedTerms = true,
    includeOutline = true,
    maxTextLength = null,
    assignNewIds = false
  } = options;

  // 1. Load document
  const buffer = await readFile(inputPath);
  const editor = await createHeadlessEditor(buffer);
  const idManager = createIdManager();

  // 2. Assign IDs to blocks
  const idsAssigned = assignBlockIds(editor, idManager);

  // 3. Extract blocks
  const blocks = extractBlocks(editor, idManager, { maxTextLength });

  // 4. Build outline (if requested)
  const outline = includeOutline ? buildOutline(blocks) : undefined;

  // 5. Extract defined terms (if requested)
  const definedTerms = includeDefinedTerms ? extractDefinedTerms(blocks) : undefined;

  // 6. Build result
  const result = {
    metadata: {
      filename: inputPath.split('/').pop(),
      generated: new Date().toISOString(),
      version: '0.2.0',
      blockCount: blocks.length,
      format: format,
      idsAssigned: idsAssigned
    },
    blocks: blocks,
    idMapping: idManager.exportMapping()
  };

  if (outline) result.outline = outline;
  if (definedTerms && Object.keys(definedTerms).length > 0) result.definedTerms = definedTerms;

  // 7. Cleanup
  editor.destroy();

  return result;
}

/**
 * Dispatch a transaction to the editor.
 * Handles both view-based and direct dispatch methods.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {Transaction} tr - ProseMirror transaction
 */
function dispatchTransaction(editor, tr) {
  if (editor.view && editor.view.dispatch) {
    editor.view.dispatch(tr);
  } else if (editor.dispatch) {
    editor.dispatch(tr);
  }
  // If neither exists, silently skip (read-only mode)
}

/**
 * Pre-register existing block IDs from the document.
 * This ensures existing sdBlockIds get sequential IDs assigned first,
 * before we generate synthetic IDs for blocks without them.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {IdManager} idManager - ID manager instance
 * @returns {number} - Number of existing IDs registered
 */
function assignBlockIds(editor, idManager) {
  const { state } = editor;
  let count = 0;

  state.doc.descendants((node, pos) => {
    // Only process block nodes with text content that have existing IDs
    if (node.isBlock && node.textContent?.trim() && node.attrs.sdBlockId) {
      // Register existing UUID with sequential ID
      idManager.registerExistingId(node.attrs.sdBlockId);
      count++;
    }
    return true;  // Continue traversal
  });

  return count;
}

/**
 * Extract all blocks from the document.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {IdManager} idManager - ID manager instance
 * @param {Object} options - Extraction options
 * @returns {Block[]}
 */
function extractBlocks(editor, idManager, options = {}) {
  const blocks = [];
  const { state } = editor;

  // Track position-based synthetic IDs for blocks without sdBlockId
  const syntheticIds = new Map();
  let syntheticCounter = 0;

  state.doc.descendants((node, pos) => {
    // Only include block nodes with text content
    if (node.isBlock && node.textContent?.trim()) {
      const text = extractNodeText(node);
      const clauseInfo = parseClauseNumber(text);
      const headingInfo = analyzeHeading(node, text);

      let id, seqId;

      if (node.attrs.sdBlockId) {
        // Use existing ID
        id = node.attrs.sdBlockId;
        seqId = idManager.getSeqId(id);
      } else {
        // Generate synthetic ID for this block (position-based)
        if (!syntheticIds.has(pos)) {
          const generated = idManager.generateId();
          syntheticIds.set(pos, generated);
        }
        const synthetic = syntheticIds.get(pos);
        id = synthetic.uuid;
        seqId = synthetic.seqId;
      }

      const block = {
        id: id,
        seqId: seqId,
        type: getBlockType(node, headingInfo),
        text: options.maxTextLength
          ? truncateText(text, options.maxTextLength)
          : text,
        startPos: pos,
        endPos: pos + node.nodeSize
      };

      // Add optional fields only if present
      if (headingInfo.isHeading && headingInfo.level) {
        block.level = headingInfo.level;
      }
      if (clauseInfo?.number) {
        block.number = clauseInfo.number;
      }

      blocks.push(block);
    }
    return true;  // Continue traversal
  });

  return blocks;
}

/**
 * Extract text content from a ProseMirror node.
 *
 * @param {Node} node - ProseMirror node
 * @returns {string}
 */
function extractNodeText(node) {
  let text = '';
  if (node.isText) return node.text || '';
  if (node.content && node.content.forEach) {
    node.content.forEach((child) => {
      text += extractNodeText(child);
    });
  }
  return text;
}

/**
 * Truncate text to maximum length with ellipsis.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Determine block type from node.
 *
 * @param {Node} node - ProseMirror node
 * @param {Object} headingInfo - Heading analysis result
 * @returns {'heading'|'paragraph'|'listItem'|'tableCell'}
 */
function getBlockType(node, headingInfo) {
  if (headingInfo.isHeading) return 'heading';
  if (node.type.name === 'listItem') return 'listItem';
  if (node.type.name === 'tableCell') return 'tableCell';
  return 'paragraph';
}

/**
 * Build hierarchical outline from blocks.
 * Groups headings with their child content.
 *
 * @param {Block[]} blocks - Flat list of blocks
 * @returns {OutlineItem[]}
 */
function buildOutline(blocks) {
  const outline = [];
  const stack = [{ level: 0, children: outline }];

  for (const block of blocks) {
    if (block.type !== 'heading') continue;

    const item = {
      id: block.id,
      seqId: block.seqId,
      level: block.level || 1,
      number: block.number || null,
      title: block.text.slice(0, 100),  // Truncate for outline
      children: []
    };

    // Find parent level
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(item);
    stack.push(item);
  }

  return outline;
}

/**
 * Extract defined terms from document.
 * Looks for patterns like "Term" means... or "Term": ...
 *
 * @param {Block[]} blocks - Document blocks
 * @returns {DefinedTermsMap}
 */
function extractDefinedTerms(blocks) {
  const terms = {};
  // Pattern: quoted term followed by "means", "shall mean", "has the meaning", or ":"
  const termPattern = /"([A-Z][^"]+)"\s+(means|shall mean|has the meaning|:)/gi;

  // First pass: find definitions
  for (const block of blocks) {
    let match;
    const regex = new RegExp(termPattern.source, 'gi');  // Reset lastIndex
    while ((match = regex.exec(block.text)) !== null) {
      const term = match[1];
      if (!terms[term]) {
        terms[term] = {
          definedIn: block.id,
          seqId: block.seqId,
          usedIn: []
        };
      }
    }
  }

  // Second pass: find usages (only if we found any terms)
  if (Object.keys(terms).length > 0) {
    for (const block of blocks) {
      for (const term of Object.keys(terms)) {
        // Skip the block where it's defined
        if (block.id === terms[term].definedIn) continue;

        // Check if term appears in this block
        if (block.text.includes(term)) {
          terms[term].usedIn.push(block.id);
        }
      }
    }
  }

  return terms;
}

/**
 * Extract IR from a buffer directly (without file path).
 *
 * @param {Buffer} buffer - DOCX file buffer
 * @param {string} filename - Original filename for metadata
 * @param {ExtractOptions} options - Extraction options
 * @returns {Promise<DocumentIR>}
 */
export async function extractDocumentIRFromBuffer(buffer, filename = 'document.docx', options = {}) {
  const {
    format = 'full',
    includeDefinedTerms = true,
    includeOutline = true,
    maxTextLength = null
  } = options;

  const editor = await createHeadlessEditor(buffer);
  const idManager = createIdManager();

  const idsAssigned = assignBlockIds(editor, idManager);
  const blocks = extractBlocks(editor, idManager, { maxTextLength });
  const outline = includeOutline ? buildOutline(blocks) : undefined;
  const definedTerms = includeDefinedTerms ? extractDefinedTerms(blocks) : undefined;

  const result = {
    metadata: {
      filename: filename,
      generated: new Date().toISOString(),
      version: '0.2.0',
      blockCount: blocks.length,
      format: format,
      idsAssigned: idsAssigned
    },
    blocks: blocks,
    idMapping: idManager.exportMapping()
  };

  if (outline) result.outline = outline;
  if (definedTerms && Object.keys(definedTerms).length > 0) result.definedTerms = definedTerms;

  editor.destroy();

  return result;
}

/**
 * Extract IR from an existing editor instance.
 * Returns both the IR and keeps the editor open for further operations.
 *
 * @param {Editor} editor - SuperDoc editor instance
 * @param {string} filename - Original filename for metadata
 * @param {ExtractOptions} options - Extraction options
 * @returns {DocumentIR}
 */
export function extractIRFromEditor(editor, filename = 'document.docx', options = {}) {
  const {
    format = 'full',
    includeDefinedTerms = true,
    includeOutline = true,
    maxTextLength = null
  } = options;

  const idManager = createIdManager();

  const idsAssigned = assignBlockIds(editor, idManager);
  const blocks = extractBlocks(editor, idManager, { maxTextLength });
  const outline = includeOutline ? buildOutline(blocks) : undefined;
  const definedTerms = includeDefinedTerms ? extractDefinedTerms(blocks) : undefined;

  const result = {
    metadata: {
      filename: filename,
      generated: new Date().toISOString(),
      version: '0.2.0',
      blockCount: blocks.length,
      format: format,
      idsAssigned: idsAssigned
    },
    blocks: blocks,
    idMapping: idManager.exportMapping()
  };

  if (outline) result.outline = outline;
  if (definedTerms && Object.keys(definedTerms).length > 0) result.definedTerms = definedTerms;

  // Note: Does NOT destroy editor - caller is responsible for cleanup
  return result;
}

/**
 * Create an editor and extract IR, returning both.
 * Use this when you need to both read the IR and perform edits on the document.
 *
 * @param {string} inputPath - Path to input DOCX file
 * @param {ExtractOptions} options - Extraction options
 * @returns {Promise<{ ir: DocumentIR, editor: Editor, cleanup: Function }>}
 */
export async function createEditorWithIR(inputPath, options = {}) {
  const buffer = await readFile(inputPath);
  const editor = await createHeadlessEditor(buffer);
  const ir = extractIRFromEditor(editor, inputPath.split('/').pop(), options);

  return {
    ir,
    editor,
    cleanup: () => editor.destroy()
  };
}
