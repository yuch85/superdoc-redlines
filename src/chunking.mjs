/**
 * Document Chunking Module - Intelligent chunking for large documents.
 *
 * This module splits large document IRs into manageable chunks while preserving
 * structural boundaries (preferring breaks at headings). Each chunk includes
 * the full document outline for LLM context.
 */

/**
 * @typedef {Object} BlockRange
 * @property {string} start - seqId of first block in chunk
 * @property {string} end - seqId of last block in chunk
 */

/**
 * @typedef {Object} ChunkMetadata
 * @property {string} filename - Original document filename
 * @property {number} chunkIndex - Zero-based index of this chunk
 * @property {number} totalChunks - Total number of chunks
 * @property {BlockRange} blockRange - Range of blocks in this chunk
 */

/**
 * @typedef {Object} ChunkedDocument
 * @property {ChunkMetadata} metadata - Chunk metadata
 * @property {OutlineItem[]} outline - Full document outline (same in every chunk)
 * @property {Block[]} blocks - Blocks in this chunk
 * @property {Object.<string, string>} idMapping - UUID to seqId mapping for blocks in this chunk
 */

/**
 * Estimate token count for a single block.
 * Uses character count / 4 as approximation plus overhead for JSON structure.
 *
 * @param {Block} block - Document block
 * @returns {number} - Estimated token count
 */
export function estimateBlockTokens(block) {
  // Base token estimate: ~4 characters per token
  const textTokens = Math.ceil((block.text?.length || 0) / 4);

  // Add overhead for JSON structure (~50 tokens for block metadata)
  const structureOverhead = 50;

  return textTokens + structureOverhead;
}

/**
 * Estimate total tokens for a full document IR.
 *
 * @param {DocumentIR} ir - Document intermediate representation
 * @returns {number} - Estimated total token count
 */
export function estimateTokens(ir) {
  let total = 0;

  // Estimate tokens for blocks
  for (const block of ir.blocks || []) {
    total += estimateBlockTokens(block);
  }

  // Add overhead for outline (estimate ~20 tokens per outline item)
  const outlineItems = countOutlineItems(ir.outline || []);
  total += outlineItems * 20;

  // Add overhead for metadata and structure (~200 tokens)
  total += 200;

  return total;
}

/**
 * Count total outline items recursively.
 *
 * @param {OutlineItem[]} outline - Outline items
 * @returns {number}
 */
function countOutlineItems(outline) {
  let count = 0;
  for (const item of outline) {
    count += 1;
    if (item.children?.length > 0) {
      count += countOutlineItems(item.children);
    }
  }
  return count;
}

/**
 * Estimate tokens for the outline structure.
 *
 * @param {OutlineItem[]} outline - Document outline
 * @returns {number}
 */
function estimateOutlineTokens(outline) {
  return countOutlineItems(outline) * 20;
}

/**
 * Find a good break point in the blocks array.
 * Prefers breaking before a heading within the last N blocks.
 *
 * @param {Block[]} blocks - Blocks to search within
 * @param {number} searchStart - Index to start searching backwards from
 * @param {number} lookbackLimit - Maximum number of blocks to look back (default: 10)
 * @returns {number} - Index to break before (the block at this index goes to next chunk)
 */
function findBreakPoint(blocks, searchStart, lookbackLimit = 10) {
  // Search backwards for a heading to break before
  const minIndex = Math.max(0, searchStart - lookbackLimit);

  for (let i = searchStart; i >= minIndex; i--) {
    if (blocks[i].type === 'heading') {
      // Break before this heading
      return i;
    }
  }

  // No heading found, break at the search start position
  return searchStart;
}

/**
 * Create a new chunk structure.
 *
 * @param {DocumentIR} ir - Source document IR
 * @param {number} chunkIndex - Zero-based chunk index
 * @param {Block[]} initialBlocks - Initial blocks for this chunk (can be empty)
 * @returns {ChunkedDocument}
 */
function createNewChunk(ir, chunkIndex, initialBlocks = []) {
  // Build idMapping for initial blocks
  const idMapping = {};
  for (const block of initialBlocks) {
    idMapping[block.id] = block.seqId;
  }

  return {
    metadata: {
      filename: ir.metadata?.filename || 'document.docx',
      chunkIndex: chunkIndex,
      totalChunks: 0,  // Will be updated at the end
      blockRange: {
        start: initialBlocks[0]?.seqId || '',
        end: initialBlocks[initialBlocks.length - 1]?.seqId || ''
      }
    },
    outline: ir.outline || [],  // Full outline included in every chunk
    blocks: [...initialBlocks],
    idMapping: idMapping
  };
}

/**
 * Finalize a chunk and add it to the chunks array.
 * Updates the blockRange end to the last block's seqId.
 *
 * @param {ChunkedDocument} chunk - Chunk to finalize
 * @param {ChunkedDocument[]} chunks - Array to add the chunk to
 */
function finalizeChunk(chunk, chunks) {
  // Update blockRange.end to reflect all blocks
  if (chunk.blocks.length > 0) {
    chunk.metadata.blockRange.start = chunk.blocks[0].seqId;
    chunk.metadata.blockRange.end = chunk.blocks[chunk.blocks.length - 1].seqId;
  }

  chunks.push(chunk);
}

/**
 * Add a block to a chunk, updating idMapping.
 *
 * @param {ChunkedDocument} chunk - Target chunk
 * @param {Block} block - Block to add
 */
function addBlockToChunk(chunk, block) {
  chunk.blocks.push(block);
  chunk.idMapping[block.id] = block.seqId;
}

/**
 * Chunk a document IR into manageable pieces.
 *
 * Algorithm:
 * 1. Iterate through blocks, tracking current token count
 * 2. When adding a block would exceed maxTokens:
 *    - Look backwards for a heading to break before (within last 10 blocks)
 *    - If found, move those blocks to next chunk
 *    - If not found, just start new chunk
 * 3. Include full outline in every chunk
 * 4. Update totalChunks in all chunks at the end
 *
 * @param {DocumentIR} ir - Document intermediate representation
 * @param {number} maxTokens - Maximum tokens per chunk (default: 100000)
 * @returns {ChunkedDocument[]} - Array of chunked documents
 */
export function chunkDocument(ir, maxTokens = 100000) {
  const blocks = ir.blocks || [];

  // If document is small enough, return as single chunk
  const totalTokens = estimateTokens(ir);
  if (totalTokens <= maxTokens || blocks.length === 0) {
    const singleChunk = createNewChunk(ir, 0, blocks);
    singleChunk.metadata.totalChunks = 1;
    return [singleChunk];
  }

  const chunks = [];

  // Calculate fixed overhead for each chunk (outline + metadata)
  const outlineTokens = estimateOutlineTokens(ir.outline || []);
  const metadataOverhead = 200;
  const fixedOverhead = outlineTokens + metadataOverhead;

  // Available tokens for blocks in each chunk
  const availableForBlocks = maxTokens - fixedOverhead;

  let currentChunk = createNewChunk(ir, 0, []);
  let currentTokenCount = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockTokens = estimateBlockTokens(block);

    // Check if adding this block would exceed the limit
    if (currentTokenCount + blockTokens > availableForBlocks && currentChunk.blocks.length > 0) {
      // Need to split - find a good break point
      const breakIndex = findBreakPoint(currentChunk.blocks, currentChunk.blocks.length - 1);

      // If break point is not at the end, we need to move blocks to next chunk
      if (breakIndex < currentChunk.blocks.length) {
        // Blocks to move to next chunk
        const blocksToMove = currentChunk.blocks.splice(breakIndex);

        // Remove moved blocks from idMapping
        for (const movedBlock of blocksToMove) {
          delete currentChunk.idMapping[movedBlock.id];
        }

        // Finalize current chunk
        finalizeChunk(currentChunk, chunks);

        // Start new chunk with moved blocks
        currentChunk = createNewChunk(ir, chunks.length, blocksToMove);
        currentTokenCount = blocksToMove.reduce((sum, b) => sum + estimateBlockTokens(b), 0);
      } else {
        // No good break point found, finalize current chunk
        finalizeChunk(currentChunk, chunks);

        // Start fresh chunk
        currentChunk = createNewChunk(ir, chunks.length, []);
        currentTokenCount = 0;
      }
    }

    // Add block to current chunk
    addBlockToChunk(currentChunk, block);
    currentTokenCount += blockTokens;
  }

  // Finalize last chunk if it has blocks
  if (currentChunk.blocks.length > 0) {
    finalizeChunk(currentChunk, chunks);
  }

  // Update totalChunks in all chunks
  const totalChunks = chunks.length;
  for (const chunk of chunks) {
    chunk.metadata.totalChunks = totalChunks;
  }

  return chunks;
}
