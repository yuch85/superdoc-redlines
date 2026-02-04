# Phase 1: Core Infrastructure

> **Priority**: Critical  
> **Dependencies**: None  
> **Deliverables**: `idManager.mjs`, `editorFactory.mjs`, `irExtractor.mjs`

[← Back to Index](./index.md)

---

## Objectives

1. Implement the dual ID system (UUID + sequential) for stable block references
2. Create a factory for headless SuperDoc editor instances
3. Build the IR extractor that produces structured JSON from DOCX files

---

## Module 1.1: ID Manager (`src/idManager.mjs`)

### Purpose

Manage the dual ID system that maps SuperDoc's UUIDs (`sdBlockId`) to human-readable sequential IDs (`seqId`).

### Rationale

1. **UUID (`sdBlockId`)**: SuperDoc's native block identifier - guaranteed unique, persists through export/import
2. **Sequential ID (`seqId`)**: Human-readable identifier (e.g., `b001`, `b002`) - easier for LLMs to reference in prompts

### Implementation

```javascript
/**
 * ID Manager for dual UUID + sequential ID system.
 */
export class IdManager {
  constructor() {
    this.uuidToSeq = new Map();  // UUID -> seqId
    this.seqToUuid = new Map();  // seqId -> UUID
    this.counter = 0;
  }
  
  /**
   * Generate a new dual ID pair.
   * @returns {{ uuid: string, seqId: string }}
   */
  generateId() {
    const uuid = crypto.randomUUID();
    const seqId = this.formatSeqId(++this.counter);
    
    this.uuidToSeq.set(uuid, seqId);
    this.seqToUuid.set(seqId, uuid);
    
    return { uuid, seqId };
  }
  
  /**
   * Register an existing UUID (from a previously structured document).
   * Assigns a new sequential ID.
   * 
   * @param {string} uuid - Existing UUID
   * @returns {string} - Assigned seqId
   */
  registerExistingId(uuid) {
    if (this.uuidToSeq.has(uuid)) {
      return this.uuidToSeq.get(uuid);
    }
    
    const seqId = this.formatSeqId(++this.counter);
    this.uuidToSeq.set(uuid, seqId);
    this.seqToUuid.set(seqId, uuid);
    
    return seqId;
  }
  
  /**
   * Get sequential ID for a UUID.
   * @param {string} uuid
   * @returns {string|null}
   */
  getSeqId(uuid) {
    return this.uuidToSeq.get(uuid) || null;
  }
  
  /**
   * Get UUID for a sequential ID.
   * @param {string} seqId
   * @returns {string|null}
   */
  getUuid(seqId) {
    return this.seqToUuid.get(seqId) || null;
  }
  
  /**
   * Format counter as sequential ID.
   * @param {number} n
   * @returns {string} - e.g., "b001", "b042", "b999"
   */
  formatSeqId(n) {
    return 'b' + n.toString().padStart(3, '0');
  }
  
  /**
   * Export ID mapping for inclusion in IR.
   * @returns {Object}
   */
  exportMapping() {
    return Object.fromEntries(this.uuidToSeq);
  }
  
  /**
   * Import ID mapping from existing IR.
   * @param {Object} mapping
   */
  importMapping(mapping) {
    for (const [uuid, seqId] of Object.entries(mapping)) {
      this.uuidToSeq.set(uuid, seqId);
      this.seqToUuid.set(seqId, uuid);
      
      // Update counter to avoid collisions
      const num = parseInt(seqId.slice(1), 10);
      if (num >= this.counter) {
        this.counter = num;
      }
    }
  }
}

/**
 * Create a new ID manager instance.
 * @returns {IdManager}
 */
export function createIdManager() {
  return new IdManager();
}
```

### Usage in IR

```json
{
  "blocks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "seqId": "b001",
      "type": "heading",
      "text": "1. DEFINITIONS"
    },
    {
      "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "seqId": "b002",
      "type": "paragraph",
      "text": "\"Accounts\" means the audited accounts..."
    }
  ],
  "idMapping": {
    "550e8400-e29b-41d4-a716-446655440000": "b001",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8": "b002"
  }
}
```

### Usage in Edits

Both ID formats are accepted:

```json
{
  "edits": [
    { "blockId": "b025", "operation": "replace", "newText": "..." },
    { "blockId": "550e8400-e29b-41d4-a716-446655440000", "operation": "delete" }
  ]
}
```

---

## Module 1.2: Editor Factory (`src/editorFactory.mjs`)

### Purpose

Create headless SuperDoc editor instances for Node.js environments.

### Dependencies

```javascript
import { Editor, getStarterExtensions } from '@harbour-enterprises/superdoc/super-editor';
import { JSDOM } from 'jsdom';
```

### Implementation

```javascript
/**
 * Create a headless SuperDoc editor instance.
 * 
 * @param {Buffer} buffer - DOCX file buffer
 * @param {EditorOptions} options - Configuration options
 * @returns {Promise<Editor>}
 * 
 * @typedef {Object} EditorOptions
 * @property {'editing'|'suggesting'} documentMode - Edit mode (default: 'editing')
 * @property {Author} user - Author info for track changes
 */
export async function createHeadlessEditor(buffer, options = {}) {
  const {
    documentMode = 'editing',
    user = { name: 'AI Assistant', email: 'ai@example.com' }
  } = options;
  
  const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const { document } = window;
  
  const [content, media, mediaFiles, fonts] = await Editor.loadXmlData(buffer, true);
  
  const editor = new Editor({
    mode: 'docx',
    documentMode: documentMode,
    documentId: 'doc-' + Date.now(),
    element: document.createElement('div'),
    extensions: getStarterExtensions(),
    fileSource: buffer,
    content,
    media,
    mediaFiles,
    fonts,
    isHeadless: true,
    document: document,
    user: user,
  });
  
  return editor;
}

/**
 * Create editor from file path.
 * 
 * @param {string} filePath - Path to DOCX file
 * @param {EditorOptions} options - Configuration options
 * @returns {Promise<Editor>}
 */
export async function createEditorFromFile(filePath, options = {}) {
  const { readFile } = await import('fs/promises');
  const buffer = await readFile(filePath);
  return createHeadlessEditor(buffer, options);
}
```

---

## Module 1.3: IR Extractor (`src/irExtractor.mjs`)

### Purpose

Extract a structured intermediate representation from a DOCX file, assigning stable IDs to all block-level elements.

### Dependencies

```javascript
import { createHeadlessEditor } from './editorFactory.mjs';
import { createIdManager } from './idManager.mjs';
import { parseClauseNumber, analyzeHeading } from './clauseParser.mjs';
import { readFile } from 'fs/promises';
```

### Main Export

```javascript
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
      format: format
    },
    blocks: blocks,
    idMapping: idManager.exportMapping()
  };
  
  if (outline) result.outline = outline;
  if (definedTerms) result.definedTerms = definedTerms;
  
  // 7. Cleanup
  editor.destroy();
  
  return result;
}
```

### Internal Functions

```javascript
/**
 * Assign IDs to all blocks that don't have them.
 * Uses dual ID system: sdBlockId (UUID) + seqId (sequential).
 * 
 * @param {Editor} editor - SuperDoc editor instance
 * @param {IdManager} idManager - ID manager instance
 * @returns {number} - Number of IDs assigned
 */
function assignBlockIds(editor, idManager) {
  const { state, view } = editor;
  const tr = state.tr;
  let count = 0;
  
  state.doc.descendants((node, pos) => {
    if (node.isBlock && node.textContent?.trim()) {
      // Check if sdBlockId already exists (from SuperDoc)
      if (!node.attrs.sdBlockId) {
        const { uuid, seqId } = idManager.generateId();
        tr.setNodeMarkup(pos, undefined, { 
          ...node.attrs, 
          sdBlockId: uuid,
          seqId: seqId  // Custom attribute for sequential ID
        });
        count++;
      } else {
        // Register existing UUID with sequential ID
        idManager.registerExistingId(node.attrs.sdBlockId);
      }
    }
    return true;
  });
  
  if (tr.docChanged) {
    view.dispatch(tr);
  }
  
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
function extractBlocks(editor, idManager, options) {
  const blocks = [];
  const { state } = editor;
  
  state.doc.descendants((node, pos) => {
    if (node.attrs.sdBlockId) {
      const text = extractNodeText(node);
      const clauseInfo = parseClauseNumber(text);
      const headingInfo = analyzeHeading(node, text);
      
      blocks.push({
        id: node.attrs.sdBlockId,
        seqId: idManager.getSeqId(node.attrs.sdBlockId),
        type: getBlockType(node, headingInfo),
        level: headingInfo.isHeading ? headingInfo.level : null,
        number: clauseInfo?.number || null,
        text: options.maxTextLength 
          ? text.slice(0, options.maxTextLength) + (text.length > options.maxTextLength ? '...' : '')
          : text,
        startPos: pos,
        endPos: pos + node.nodeSize
      });
    }
    return true;
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
      number: block.number,
      title: block.text.slice(0, 100),
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
  const termPattern = /"([A-Z][^"]+)"\s+(means|shall mean|has the meaning|:)/gi;
  
  for (const block of blocks) {
    let match;
    while ((match = termPattern.exec(block.text)) !== null) {
      const term = match[1];
      if (!terms[term]) {
        terms[term] = { definedIn: block.id, usedIn: [] };
      }
    }
  }
  
  // Second pass: find usages
  for (const block of blocks) {
    for (const term of Object.keys(terms)) {
      if (block.text.includes(term) && block.id !== terms[term].definedIn) {
        terms[term].usedIn.push(block.id);
      }
    }
  }
  
  return terms;
}
```

---

## Output Types

```typescript
interface DocumentIR {
  metadata: {
    filename: string;
    generated: string;           // ISO timestamp
    version: '0.2.0';
    blockCount: number;
    format: 'full' | 'outline' | 'blocks';
  };
  outline?: OutlineItem[];       // Hierarchical structure
  blocks: Block[];               // All document blocks
  definedTerms?: DefinedTermsMap;
  idMapping: {                   // UUID <-> seqId mapping
    [uuid: string]: string;      // uuid -> seqId
  };
}

interface Block {
  id: string;                    // UUID (sdBlockId from SuperDoc)
  seqId: string;                 // Sequential ID (e.g., "b001")
  type: 'heading' | 'paragraph' | 'listItem' | 'tableCell';
  level?: number;                // For headings: 1-6
  number?: string;               // Clause number: "3.2.1"
  text: string;
  parent?: string;               // Parent block ID (for hierarchy)
  children?: string[];           // Child block IDs
  startPos: number;              // ProseMirror position
  endPos: number;
}

interface OutlineItem {
  id: string;
  seqId: string;
  level: number;
  number?: string;
  title: string;
  children: OutlineItem[];
}

interface DefinedTermsMap {
  [term: string]: {
    definedIn: string;           // Block ID where defined
    usedIn: string[];            // Block IDs where used
  };
}
```

---

## Test Requirements

### File: `tests/idManager.test.mjs`

```javascript
describe('IdManager', () => {
  test('generates unique UUIDs', () => {
    const manager = createIdManager();
    const id1 = manager.generateId();
    const id2 = manager.generateId();
    expect(id1.uuid).not.toBe(id2.uuid);
  });
  
  test('generates sequential seqIds', () => {
    const manager = createIdManager();
    const id1 = manager.generateId();
    const id2 = manager.generateId();
    expect(id1.seqId).toBe('b001');
    expect(id2.seqId).toBe('b002');
  });
  
  test('registers existing UUIDs', () => {
    const manager = createIdManager();
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const seqId = manager.registerExistingId(uuid);
    expect(seqId).toBe('b001');
    expect(manager.getSeqId(uuid)).toBe('b001');
    expect(manager.getUuid('b001')).toBe(uuid);
  });
  
  test('exports and imports mapping', () => {
    const manager1 = createIdManager();
    manager1.generateId();
    manager1.generateId();
    const mapping = manager1.exportMapping();
    
    const manager2 = createIdManager();
    manager2.importMapping(mapping);
    expect(manager2.counter).toBe(2);
  });
});
```

### File: `tests/irExtractor.test.mjs`

```javascript
describe('extractDocumentIR', () => {
  test('extracts all blocks with IDs', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    expect(ir.blocks.length).toBeGreaterThan(0);
    expect(ir.blocks.every(b => b.id && b.seqId)).toBe(true);
  });
  
  test('assigns sequential IDs in order', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const seqIds = ir.blocks.map(b => b.seqId);
    expect(seqIds[0]).toBe('b001');
    expect(seqIds[1]).toBe('b002');
  });
  
  test('detects headings correctly', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    const headings = ir.blocks.filter(b => b.type === 'heading');
    expect(headings.length).toBeGreaterThan(0);
  });
  
  test('extracts defined terms', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    expect(Object.keys(ir.definedTerms).length).toBeGreaterThan(0);
  });
  
  test('builds hierarchical outline', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    expect(ir.outline).toBeDefined();
    expect(ir.outline.length).toBeGreaterThan(0);
  });
  
  test('respects maxTextLength option', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx', { maxTextLength: 50 });
    const longBlocks = ir.blocks.filter(b => b.text.length > 53); // 50 + "..."
    expect(longBlocks.length).toBe(0);
  });
  
  test('produces valid idMapping', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    expect(Object.keys(ir.idMapping).length).toBe(ir.blocks.length);
    for (const block of ir.blocks) {
      expect(ir.idMapping[block.id]).toBe(block.seqId);
    }
  });
});
```

---

## Success Criteria

1. **ID Manager works correctly**
   - Generates unique UUIDs
   - Maintains sequential seqId counter
   - Bidirectional lookup works (uuid ↔ seqId)
   - Import/export preserves state

2. **Editor Factory creates valid editors**
   - Headless mode works without errors
   - Document content is accessible
   - Track changes mode can be enabled

3. **IR Extractor produces complete output**
   - All blocks have IDs assigned
   - Outline is hierarchical and correct
   - Defined terms are detected
   - Position information is accurate

4. **Tests pass**
   - `npm test` runs all Phase 1 tests successfully
   - No regressions in existing tests

---

## Exit Conditions

- [ ] `src/idManager.mjs` implemented and tested
- [ ] `src/editorFactory.mjs` implemented and tested
- [ ] `src/irExtractor.mjs` implemented and tested
- [ ] All Phase 1 tests pass
- [ ] Can extract IR from `fixtures/asset-purchase.docx` without errors
- [ ] IR JSON output is valid and contains expected structure

---

[← Back to Index](./index.md) | [Next: Phase 2 →](./phase-2-block-operations.md)
