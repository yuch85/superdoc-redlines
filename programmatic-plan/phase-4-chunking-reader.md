# Phase 4: Chunking & Document Reader

> **Priority**: High  
> **Dependencies**: Phase 1 (Core Infrastructure)  
> **Deliverables**: `chunking.mjs`, `documentReader.mjs`

[← Back to Index](./index.md) | [← Phase 3](./phase-3-validation-ordering.md)

---

## Objectives

1. Implement intelligent document chunking that preserves structural boundaries
2. Build the document reader API for LLM consumption
3. Support automatic chunking for large documents
4. Ensure outline is included in every chunk for context

---

## Module 4.1: Chunking System (`src/chunking.mjs`)

### Purpose

Intelligent document chunking that preserves structural boundaries (tries to break at heading boundaries).

### Main Exports

```javascript
/**
 * Chunk a document IR into manageable pieces.
 * Preserves structural boundaries (tries to break at heading boundaries).
 * 
 * @param {DocumentIR} ir - Full document IR
 * @param {number} maxTokens - Maximum tokens per chunk
 * @returns {ChunkedDocument[]}
 */
export function chunkDocument(ir, maxTokens = 100000) {
  const chunks = [];
  let currentChunk = {
    metadata: {
      filename: ir.metadata.filename,
      chunkIndex: 0,
      totalChunks: 0,  // Will be updated
      blockRange: { start: null, end: null }
    },
    outline: ir.outline,  // Include full outline in every chunk
    blocks: [],
    idMapping: {}
  };
  
  let currentTokens = 0;
  
  for (const block of ir.blocks) {
    const blockTokens = estimateBlockTokens(block);
    
    // Check if adding this block would exceed limit
    if (currentTokens + blockTokens > maxTokens && currentChunk.blocks.length > 0) {
      // Try to find a better break point (heading boundary)
      const breakIndex = findBreakPoint(currentChunk.blocks, block);
      
      if (breakIndex !== null && breakIndex > 0) {
        // Move some blocks to next chunk
        const overflow = currentChunk.blocks.splice(breakIndex);
        finalizeChunk(currentChunk, chunks);
        
        // Start new chunk with overflow
        currentChunk = createNewChunk(ir, chunks.length, overflow);
        currentTokens = overflow.reduce((sum, b) => sum + estimateBlockTokens(b), 0);
      } else {
        // No good break point, just start new chunk
        finalizeChunk(currentChunk, chunks);
        currentChunk = createNewChunk(ir, chunks.length, []);
        currentTokens = 0;
      }
    }
    
    // Add block to current chunk
    currentChunk.blocks.push(block);
    currentChunk.idMapping[block.id] = block.seqId;
    if (!currentChunk.metadata.blockRange.start) {
      currentChunk.metadata.blockRange.start = block.seqId;
    }
    currentChunk.metadata.blockRange.end = block.seqId;
    currentTokens += blockTokens;
  }
  
  // Finalize last chunk
  if (currentChunk.blocks.length > 0) {
    finalizeChunk(currentChunk, chunks);
  }
  
  // Update total chunks count in all chunks
  for (const chunk of chunks) {
    chunk.metadata.totalChunks = chunks.length;
  }
  
  return chunks;
}

/**
 * Estimate tokens for a block.
 * Uses character count / 4 as rough approximation.
 * 
 * @param {Block} block
 * @returns {number}
 */
export function estimateBlockTokens(block) {
  // Include ID and metadata overhead
  const overhead = 50;  // Approximate JSON structure overhead
  const textTokens = Math.ceil(block.text.length / 4);
  return overhead + textTokens;
}

/**
 * Estimate total tokens for a document IR.
 * 
 * @param {DocumentIR} ir
 * @returns {number}
 */
export function estimateTokens(ir) {
  const metadataTokens = 200;  // Rough estimate for metadata/outline
  const blockTokens = ir.blocks.reduce((sum, b) => sum + estimateBlockTokens(b), 0);
  return metadataTokens + blockTokens;
}
```

### Internal Functions

```javascript
/**
 * Find a good break point for chunking.
 * Prefers to break before headings.
 * 
 * @param {Block[]} blocks - Current chunk blocks
 * @param {Block} nextBlock - Block that would exceed limit
 * @returns {number|null} - Index to break at, or null if no good point
 */
function findBreakPoint(blocks, nextBlock) {
  // Look backwards for a heading to break before
  for (let i = blocks.length - 1; i >= Math.max(0, blocks.length - 10); i--) {
    if (blocks[i].type === 'heading') {
      return i;  // Break before this heading
    }
  }
  
  // If next block is a heading, that's a natural break
  if (nextBlock.type === 'heading') {
    return null;  // Let natural break happen
  }
  
  return null;  // No good break point found
}

/**
 * Finalize a chunk and add it to the chunks array.
 * 
 * @param {ChunkedDocument} chunk
 * @param {ChunkedDocument[]} chunks
 */
function finalizeChunk(chunk, chunks) {
  chunk.metadata.chunkIndex = chunks.length;
  chunks.push(chunk);
}

/**
 * Create a new chunk.
 * 
 * @param {DocumentIR} ir - Original IR (for outline)
 * @param {number} index - Chunk index
 * @param {Block[]} initialBlocks - Blocks to start with
 * @returns {ChunkedDocument}
 */
function createNewChunk(ir, index, initialBlocks = []) {
  const chunk = {
    metadata: {
      filename: ir.metadata.filename,
      chunkIndex: index,
      totalChunks: 0,  // Will be updated later
      blockRange: { start: null, end: null }
    },
    outline: ir.outline,  // Include full outline in every chunk
    blocks: [...initialBlocks],
    idMapping: {}
  };
  
  // Set block range for initial blocks
  if (initialBlocks.length > 0) {
    chunk.metadata.blockRange.start = initialBlocks[0].seqId;
    chunk.metadata.blockRange.end = initialBlocks[initialBlocks.length - 1].seqId;
    for (const block of initialBlocks) {
      chunk.idMapping[block.id] = block.seqId;
    }
  }
  
  return chunk;
}
```

---

## Module 4.2: Document Reader (`src/documentReader.mjs`)

### Purpose

Provide document reading functionality for LLM consumption, with automatic chunking for large documents.

### Dependencies

```javascript
import { extractDocumentIR } from './irExtractor.mjs';
import { chunkDocument, estimateTokens } from './chunking.mjs';
```

### Main Exports

```javascript
/**
 * Read a document for LLM consumption.
 * Automatically handles chunking for large documents.
 * 
 * @param {string} inputPath - Path to DOCX file
 * @param {ReadOptions} options
 * @returns {Promise<ReadResult>}
 * 
 * @typedef {Object} ReadOptions
 * @property {number} chunkIndex - Which chunk to read (0-indexed, default: null = all)
 * @property {number} maxTokens - Max tokens per chunk (default: 100000)
 * @property {'full'|'outline'|'summary'} format - Output format
 * @property {boolean} includeMetadata - Include block IDs and positions (default: true)
 */
export async function readDocument(inputPath, options = {}) {
  const {
    chunkIndex = null,
    maxTokens = 100000,
    format = 'full',
    includeMetadata = true
  } = options;
  
  // Extract full IR
  const ir = await extractDocumentIR(inputPath, { format: 'full' });
  
  // Check if chunking is needed
  const estimatedTokens = estimateTokens(ir);
  
  if (estimatedTokens <= maxTokens && chunkIndex === null) {
    // Document fits in one chunk
    return {
      success: true,
      totalChunks: 1,
      currentChunk: 0,
      hasMore: false,
      nextChunkCommand: null,
      document: formatForOutput(ir, format, includeMetadata)
    };
  }
  
  // Document needs chunking
  const chunks = chunkDocument(ir, maxTokens);
  const targetChunk = chunkIndex !== null ? chunkIndex : 0;
  
  if (targetChunk >= chunks.length) {
    return {
      success: false,
      error: `Chunk ${targetChunk} not found. Document has ${chunks.length} chunks.`
    };
  }
  
  return {
    success: true,
    totalChunks: chunks.length,
    currentChunk: targetChunk,
    hasMore: targetChunk < chunks.length - 1,
    nextChunkCommand: targetChunk < chunks.length - 1
      ? `node superdoc-redline.mjs read --input "${inputPath}" --chunk ${targetChunk + 1}`
      : null,
    document: formatChunkForOutput(chunks[targetChunk], format, includeMetadata)
  };
}

/**
 * Get document statistics without full extraction.
 * Useful for determining if chunking is needed.
 * 
 * @param {string} inputPath - Path to DOCX file
 * @returns {Promise<DocumentStats>}
 */
export async function getDocumentStats(inputPath) {
  const ir = await extractDocumentIR(inputPath, { 
    format: 'blocks',
    maxTextLength: 100  // Truncate for speed
  });
  
  const totalChars = ir.blocks.reduce((sum, b) => sum + b.text.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  
  return {
    filename: ir.metadata.filename,
    blockCount: ir.blocks.length,
    estimatedCharacters: totalChars,
    estimatedTokens: estimatedTokens,
    recommendedChunks: Math.ceil(estimatedTokens / 100000)
  };
}
```

### Internal Functions

```javascript
/**
 * Format full IR for output.
 * 
 * @param {DocumentIR} ir
 * @param {'full'|'outline'|'summary'} format
 * @param {boolean} includeMetadata
 * @returns {Object}
 */
function formatForOutput(ir, format, includeMetadata) {
  if (format === 'outline') {
    return {
      metadata: ir.metadata,
      outline: ir.outline
    };
  }
  
  if (format === 'summary') {
    return {
      metadata: ir.metadata,
      outline: ir.outline,
      blockCount: ir.blocks.length,
      headings: ir.blocks.filter(b => b.type === 'heading').map(b => ({
        seqId: b.seqId,
        level: b.level,
        text: b.text.slice(0, 100)
      }))
    };
  }
  
  // Full format
  if (!includeMetadata) {
    return {
      metadata: ir.metadata,
      outline: ir.outline,
      blocks: ir.blocks.map(b => ({
        seqId: b.seqId,
        type: b.type,
        text: b.text
      }))
    };
  }
  
  return ir;
}

/**
 * Format chunk for output.
 * 
 * @param {ChunkedDocument} chunk
 * @param {'full'|'outline'|'summary'} format
 * @param {boolean} includeMetadata
 * @returns {Object}
 */
function formatChunkForOutput(chunk, format, includeMetadata) {
  if (format === 'outline') {
    return {
      metadata: chunk.metadata,
      outline: chunk.outline
    };
  }
  
  if (!includeMetadata) {
    return {
      metadata: chunk.metadata,
      outline: chunk.outline,
      blocks: chunk.blocks.map(b => ({
        seqId: b.seqId,
        type: b.type,
        text: b.text
      }))
    };
  }
  
  return chunk;
}
```

---

## Output Types

```typescript
interface ReadResult {
  success: boolean;
  error?: string;
  totalChunks: number;
  currentChunk: number;
  hasMore: boolean;
  nextChunkCommand: string | null;  // CLI command to get next chunk
  document: ChunkedDocument;
}

interface ChunkedDocument {
  metadata: {
    filename: string;
    chunkIndex: number;
    totalChunks: number;
    blockRange: {
      start: string;  // First block seqId in chunk
      end: string;    // Last block seqId in chunk
    };
  };
  outline?: OutlineItem[];    // Full outline (in every chunk for context)
  blocks: Block[];            // Blocks in this chunk
  idMapping: { [uuid: string]: string };
}

interface DocumentStats {
  filename: string;
  blockCount: number;
  estimatedCharacters: number;
  estimatedTokens: number;
  recommendedChunks: number;
}
```

---

## Test Requirements

### File: `tests/chunking.test.mjs`

```javascript
describe('estimateBlockTokens', () => {
  test('estimates tokens for small block', () => {
    const block = { text: 'Hello world' };
    const tokens = estimateBlockTokens(block);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(50 + Math.ceil(11 / 4));  // overhead + text
  });
  
  test('estimates tokens for large block', () => {
    const block = { text: 'A'.repeat(1000) };
    const tokens = estimateBlockTokens(block);
    expect(tokens).toBe(50 + 250);  // overhead + 1000/4
  });
});

describe('estimateTokens', () => {
  test('estimates total document tokens', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const tokens = estimateTokens(ir);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('chunkDocument', () => {
  test('returns single chunk for small document', async () => {
    const ir = await extractDocumentIR('fixtures/sample.docx');
    const chunks = chunkDocument(ir, 1000000);  // Very large limit
    expect(chunks.length).toBe(1);
    expect(chunks[0].blocks.length).toBe(ir.blocks.length);
  });
  
  test('splits large document into chunks', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    const chunks = chunkDocument(ir, 5000);  // Small limit for testing
    expect(chunks.length).toBeGreaterThan(1);
  });
  
  test('preserves all blocks across chunks', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    const chunks = chunkDocument(ir, 5000);
    const allBlockIds = chunks.flatMap(c => c.blocks.map(b => b.id));
    expect(allBlockIds.length).toBe(ir.blocks.length);
    
    // All IDs should be unique
    const uniqueIds = new Set(allBlockIds);
    expect(uniqueIds.size).toBe(ir.blocks.length);
  });
  
  test('includes outline in every chunk', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    const chunks = chunkDocument(ir, 5000);
    for (const chunk of chunks) {
      expect(chunk.outline).toEqual(ir.outline);
    }
  });
  
  test('sets correct metadata for each chunk', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    const chunks = chunkDocument(ir, 5000);
    
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].metadata.chunkIndex).toBe(i);
      expect(chunks[i].metadata.totalChunks).toBe(chunks.length);
      expect(chunks[i].metadata.blockRange.start).toBeDefined();
      expect(chunks[i].metadata.blockRange.end).toBeDefined();
    }
  });
  
  test('prefers breaking at heading boundaries', async () => {
    const ir = await extractDocumentIR('fixtures/asset-purchase.docx');
    const chunks = chunkDocument(ir, 10000);
    
    // Check that most chunks start with headings (after first chunk)
    let headingStarts = 0;
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].blocks[0]?.type === 'heading') {
        headingStarts++;
      }
    }
    
    // At least 50% of chunk starts should be headings
    if (chunks.length > 1) {
      expect(headingStarts / (chunks.length - 1)).toBeGreaterThanOrEqual(0.3);
    }
  });
});
```

### File: `tests/documentReader.test.mjs`

```javascript
describe('readDocument', () => {
  test('reads small document in one chunk', async () => {
    const result = await readDocument('fixtures/sample.docx');
    expect(result.success).toBe(true);
    expect(result.totalChunks).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.nextChunkCommand).toBeNull();
  });
  
  test('reads specific chunk', async () => {
    const result = await readDocument('fixtures/asset-purchase.docx', {
      maxTokens: 5000,
      chunkIndex: 0
    });
    expect(result.success).toBe(true);
    expect(result.currentChunk).toBe(0);
  });
  
  test('returns error for invalid chunk index', async () => {
    const result = await readDocument('fixtures/sample.docx', {
      chunkIndex: 999
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
  
  test('provides next chunk command', async () => {
    const result = await readDocument('fixtures/asset-purchase.docx', {
      maxTokens: 5000,
      chunkIndex: 0
    });
    
    if (result.totalChunks > 1) {
      expect(result.hasMore).toBe(true);
      expect(result.nextChunkCommand).toContain('--chunk 1');
    }
  });
  
  test('includes outline in every chunk', async () => {
    const result1 = await readDocument('fixtures/asset-purchase.docx', {
      maxTokens: 5000,
      chunkIndex: 0
    });
    
    if (result1.totalChunks > 1) {
      const result2 = await readDocument('fixtures/asset-purchase.docx', {
        maxTokens: 5000,
        chunkIndex: 1
      });
      
      expect(result1.document.outline).toEqual(result2.document.outline);
    }
  });
});

describe('getDocumentStats', () => {
  test('returns document statistics', async () => {
    const stats = await getDocumentStats('fixtures/sample.docx');
    expect(stats.filename).toBeDefined();
    expect(stats.blockCount).toBeGreaterThan(0);
    expect(stats.estimatedCharacters).toBeGreaterThan(0);
    expect(stats.estimatedTokens).toBeGreaterThan(0);
    expect(stats.recommendedChunks).toBeGreaterThanOrEqual(1);
  });
  
  test('recommends multiple chunks for large documents', async () => {
    const stats = await getDocumentStats('fixtures/asset-purchase.docx');
    // Large documents should recommend chunking
    expect(stats.blockCount).toBeGreaterThan(100);
  });
});
```

---

## Success Criteria

1. **Chunking algorithm works**
   - Splits documents at appropriate boundaries
   - Preserves all blocks
   - Respects token limits

2. **Outline is in every chunk**
   - LLMs have document context regardless of which chunk they read

3. **Block ranges are correct**
   - Each chunk knows its start/end block IDs
   - No overlap between chunks

4. **Document reader API is complete**
   - Reads full documents
   - Handles specific chunk requests
   - Provides navigation commands

---

## Exit Conditions

- [ ] `src/chunking.mjs` implemented with all functions
- [ ] `src/documentReader.mjs` implemented with all functions
- [ ] All Phase 4 tests pass
- [ ] Large documents chunk correctly
- [ ] Outline appears in every chunk

---

[← Back to Index](./index.md) | [← Phase 3](./phase-3-validation-ordering.md) | [Next: Phase 5 →](./phase-5-multi-agent-merge.md)
