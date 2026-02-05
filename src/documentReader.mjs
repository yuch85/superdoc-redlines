/**
 * Document Reader - Phase 4 of the superdoc-redlines project.
 *
 * This module provides document reading functionality for LLM consumption,
 * with automatic chunking support for large documents that exceed token limits.
 *
 * Key features:
 * - Automatic chunking when documents exceed token limits
 * - Multiple output formats (full, outline, summary)
 * - CLI command generation for chunk navigation
 * - Token estimation for planning
 */

import { extractDocumentIR } from './irExtractor.mjs';
import { chunkDocument, estimateTokens } from './chunking.mjs';

/**
 * Read a document for LLM consumption.
 * Automatically handles chunking for large documents.
 *
 * @param {string} inputPath - Path to DOCX file
 * @param {ReadOptions} options - Reading options
 * @returns {Promise<ReadResult>} - Structured document data
 *
 * @typedef {Object} ReadOptions
 * @property {number|null} chunkIndex - Which chunk to read (0-indexed, default: null = first/all)
 * @property {number} maxTokens - Max tokens per chunk (default: 100000)
 * @property {'full'|'outline'|'summary'} format - Output format (default: 'full')
 * @property {boolean} includeMetadata - Include block IDs and positions (default: true)
 *
 * @typedef {Object} ReadResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if success is false
 * @property {number} totalChunks - Total number of chunks
 * @property {number} currentChunk - Current chunk index (0-indexed)
 * @property {boolean} hasMore - Whether there are more chunks after this one
 * @property {string|null} nextChunkCommand - CLI command to get next chunk
 * @property {ChunkedDocument|FormattedDocument} document - The document data
 */
export async function readDocument(inputPath, options = {}) {
  const {
    chunkIndex = null,
    maxTokens = 100000,
    format = 'full',
    includeMetadata = true
  } = options;

  try {
    // 1. Extract full IR
    const ir = await extractDocumentIR(inputPath, { format: 'full' });

    // 2. Estimate tokens
    const estimatedTokens = estimateTokens(ir);

    // 3. Determine if chunking is needed
    const needsChunking = estimatedTokens > maxTokens;
    const specificChunkRequested = chunkIndex !== null;

    if (!needsChunking && !specificChunkRequested) {
      // Document fits in a single chunk, return everything formatted
      const formattedDoc = formatForOutput(ir, format, includeMetadata);

      return {
        success: true,
        totalChunks: 1,
        currentChunk: 0,
        hasMore: false,
        nextChunkCommand: null,
        document: formattedDoc
      };
    }

    // 4. Chunk the document
    const chunks = chunkDocument(ir, maxTokens);
    const targetChunk = specificChunkRequested ? chunkIndex : 0;

    // 5. Validate chunk index
    if (targetChunk < 0 || targetChunk >= chunks.length) {
      return {
        success: false,
        error: `Chunk ${targetChunk} not found. Document has ${chunks.length} chunk(s) (valid indices: 0-${chunks.length - 1}).`,
        totalChunks: chunks.length,
        currentChunk: targetChunk,
        hasMore: false,
        nextChunkCommand: null,
        document: null
      };
    }

    // 6. Format the requested chunk
    const chunk = chunks[targetChunk];
    const formattedChunk = formatChunkForOutput(chunk, format, includeMetadata);

    // 7. Generate next chunk command if applicable
    const hasMore = targetChunk < chunks.length - 1;
    const nextChunkCommand = hasMore
      ? `node superdoc-redline.mjs read --input "${inputPath}" --chunk ${targetChunk + 1}`
      : null;

    return {
      success: true,
      totalChunks: chunks.length,
      currentChunk: targetChunk,
      hasMore,
      nextChunkCommand,
      document: formattedChunk
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read document: ${error.message}`,
      totalChunks: 0,
      currentChunk: 0,
      hasMore: false,
      nextChunkCommand: null,
      document: null
    };
  }
}

/**
 * Get document statistics without full extraction.
 * Useful for determining if chunking is needed before reading.
 *
 * @param {string} inputPath - Path to DOCX file
 * @param {Object} options - Options for stats calculation
 * @param {number} [options.maxTokens] - User-specified max tokens per chunk (affects recommendedChunks)
 * @returns {Promise<DocumentStats>} - Quick statistics about the document
 *
 * @typedef {Object} DocumentStats
 * @property {string} filename - Document filename
 * @property {number} blockCount - Number of blocks in the document
 * @property {number} estimatedCharacters - Total character count
 * @property {number} estimatedTokens - Estimated token count
 * @property {number} recommendedChunks - Recommended number of chunks (based on maxTokens or default 100k)
 * @property {Object} recommendedChunksByLimit - Chunk recommendations for various token limits
 */
export async function getDocumentStats(inputPath, options = {}) {
  const { maxTokens = 100000 } = options;

  try {
    // Extract with truncated text for speed
    const ir = await extractDocumentIR(inputPath, {
      format: 'blocks',
      maxTextLength: 100,
      includeDefinedTerms: false,
      includeOutline: false
    });

    // Calculate character count from truncated blocks
    // Since we truncated to 100 chars, we need to estimate full length
    // We'll use the block count and average document statistics
    const truncatedChars = ir.blocks.reduce((sum, block) => sum + block.text.length, 0);

    // If many blocks are truncated (text ends with '...'), estimate true size
    const truncatedBlockCount = ir.blocks.filter(b => b.text.endsWith('...')).length;
    const avgBlockLength = 200; // Average paragraph length assumption
    const estimatedCharacters = truncatedBlockCount > 0
      ? truncatedChars + (truncatedBlockCount * (avgBlockLength - 100))
      : truncatedChars;

    // Rough token estimate: ~4 characters per token
    const estimatedTokens = Math.ceil(estimatedCharacters / 4);

    // Recommended chunks based on user-specified max tokens (or default 100k)
    // Note: Actual chunks may be higher due to block boundary preservation
    // We apply a multiplier to account for this, but only when chunking is needed
    const simpleEstimate = Math.max(1, Math.ceil(estimatedTokens / maxTokens));
    // Only apply multiplier if document needs chunking (>1 chunk); small docs stay at 1
    const blockBoundaryMultiplier = 1.5; // Actual chunks are typically 1.5-2x the simple estimate
    const recommendedChunks = simpleEstimate === 1 ? 1 : Math.ceil(simpleEstimate * blockBoundaryMultiplier);

    // Also provide recommendations for common token limits
    // Include both simple estimate and adjusted estimate for transparency
    const recommendedChunksByLimit = {
      "10k": {
        simple: Math.max(1, Math.ceil(estimatedTokens / 10000)),
        adjusted: Math.max(1, Math.ceil(Math.ceil(estimatedTokens / 10000) * blockBoundaryMultiplier))
      },
      "25k": {
        simple: Math.max(1, Math.ceil(estimatedTokens / 25000)),
        adjusted: Math.max(1, Math.ceil(Math.ceil(estimatedTokens / 25000) * blockBoundaryMultiplier))
      },
      "40k": {
        simple: Math.max(1, Math.ceil(estimatedTokens / 40000)),
        adjusted: Math.max(1, Math.ceil(Math.ceil(estimatedTokens / 40000) * blockBoundaryMultiplier))
      },
      "100k": {
        simple: Math.max(1, Math.ceil(estimatedTokens / 100000)),
        adjusted: Math.max(1, Math.ceil(Math.ceil(estimatedTokens / 100000) * blockBoundaryMultiplier))
      }
    };

    return {
      filename: ir.metadata.filename,
      blockCount: ir.blocks.length,
      estimatedCharacters,
      estimatedTokens,
      recommendedChunks,
      recommendedChunksByLimit,
      maxTokensUsed: maxTokens,
      note: 'Chunk counts are estimates. Actual chunks may be 1.5-2x higher due to block boundary preservation.'
    };
  } catch (error) {
    throw new Error(`Failed to get document stats: ${error.message}`);
  }
}

/**
 * Format a full IR for output based on the requested format.
 *
 * @param {DocumentIR} ir - Full document intermediate representation
 * @param {'full'|'outline'|'summary'} format - Output format
 * @param {boolean} includeMetadata - Whether to include block IDs and positions
 * @returns {FormattedDocument} - Formatted document
 */
function formatForOutput(ir, format, includeMetadata) {
  switch (format) {
    case 'outline':
      return formatAsOutline(ir, includeMetadata);
    case 'summary':
      return formatAsSummary(ir, includeMetadata);
    case 'full':
    default:
      return formatAsFull(ir, includeMetadata);
  }
}

/**
 * Format a chunk for output based on the requested format.
 *
 * @param {ChunkedDocument} chunk - Document chunk
 * @param {'full'|'outline'|'summary'} format - Output format
 * @param {boolean} includeMetadata - Whether to include block IDs and positions
 * @returns {FormattedDocument} - Formatted chunk
 */
function formatChunkForOutput(chunk, format, includeMetadata) {
  switch (format) {
    case 'outline':
      return formatChunkAsOutline(chunk, includeMetadata);
    case 'summary':
      return formatChunkAsSummary(chunk, includeMetadata);
    case 'full':
    default:
      return formatChunkAsFull(chunk, includeMetadata);
  }
}

/**
 * Format IR as full output with all details.
 *
 * @param {DocumentIR} ir - Full document IR
 * @param {boolean} includeMetadata - Whether to include block IDs and positions
 * @returns {FormattedDocument}
 */
function formatAsFull(ir, includeMetadata) {
  const result = {
    metadata: { ...ir.metadata },
    outline: ir.outline,
    blocks: includeMetadata
      ? ir.blocks
      : stripMetadataFromBlocks(ir.blocks),
    definedTerms: ir.definedTerms
  };

  if (includeMetadata) {
    result.idMapping = ir.idMapping;
  }

  return result;
}

/**
 * Format IR as outline only.
 *
 * @param {DocumentIR} ir - Full document IR
 * @param {boolean} includeMetadata - Whether to include block IDs
 * @returns {FormattedDocument}
 */
function formatAsOutline(ir, includeMetadata) {
  const result = {
    metadata: { ...ir.metadata },
    outline: includeMetadata
      ? ir.outline
      : stripMetadataFromOutline(ir.outline)
  };

  return result;
}

/**
 * Format IR as summary (metadata, outline, block count, and headings list).
 *
 * @param {DocumentIR} ir - Full document IR
 * @param {boolean} includeMetadata - Whether to include block IDs
 * @returns {FormattedDocument}
 */
function formatAsSummary(ir, includeMetadata) {
  // Extract headings from blocks
  const headings = ir.blocks
    .filter(block => block.type === 'heading')
    .map(block => {
      const heading = {
        text: truncateText(block.text, 100),
        level: block.level
      };

      if (includeMetadata) {
        heading.id = block.id;
        heading.seqId = block.seqId;
      }

      if (block.number) {
        heading.number = block.number;
      }

      return heading;
    });

  const result = {
    metadata: { ...ir.metadata },
    outline: includeMetadata
      ? ir.outline
      : stripMetadataFromOutline(ir.outline),
    blockCount: ir.blocks.length,
    headings
  };

  return result;
}

/**
 * Format a chunk as full output.
 *
 * @param {ChunkedDocument} chunk - Document chunk
 * @param {boolean} includeMetadata - Whether to include block IDs and positions
 * @returns {FormattedDocument}
 */
function formatChunkAsFull(chunk, includeMetadata) {
  const result = {
    metadata: { ...chunk.metadata },
    outline: chunk.outline,  // Full outline for context
    blocks: includeMetadata
      ? chunk.blocks
      : stripMetadataFromBlocks(chunk.blocks)
  };

  if (includeMetadata) {
    result.idMapping = chunk.idMapping;
  }

  return result;
}

/**
 * Format a chunk as outline only.
 *
 * @param {ChunkedDocument} chunk - Document chunk
 * @param {boolean} includeMetadata - Whether to include block IDs
 * @returns {FormattedDocument}
 */
function formatChunkAsOutline(chunk, includeMetadata) {
  return {
    metadata: { ...chunk.metadata },
    outline: includeMetadata
      ? chunk.outline
      : stripMetadataFromOutline(chunk.outline)
  };
}

/**
 * Format a chunk as summary.
 *
 * @param {ChunkedDocument} chunk - Document chunk
 * @param {boolean} includeMetadata - Whether to include block IDs
 * @returns {FormattedDocument}
 */
function formatChunkAsSummary(chunk, includeMetadata) {
  // Extract headings from chunk blocks
  const headings = chunk.blocks
    .filter(block => block.type === 'heading')
    .map(block => {
      const heading = {
        text: truncateText(block.text, 100),
        level: block.level
      };

      if (includeMetadata) {
        heading.id = block.id;
        heading.seqId = block.seqId;
      }

      if (block.number) {
        heading.number = block.number;
      }

      return heading;
    });

  return {
    metadata: { ...chunk.metadata },
    outline: includeMetadata
      ? chunk.outline
      : stripMetadataFromOutline(chunk.outline),
    blockCount: chunk.blocks.length,
    headings
  };
}

/**
 * Strip metadata (IDs, positions) from blocks.
 *
 * @param {Block[]} blocks - Array of blocks
 * @returns {Block[]} - Blocks with metadata removed
 */
function stripMetadataFromBlocks(blocks) {
  return blocks.map(block => {
    const { id, seqId, startPos, endPos, ...rest } = block;
    return rest;
  });
}

/**
 * Strip metadata (IDs) from outline items recursively.
 *
 * @param {OutlineItem[]} outline - Array of outline items
 * @returns {OutlineItem[]} - Outline with metadata removed
 */
function stripMetadataFromOutline(outline) {
  if (!outline) return outline;

  return outline.map(item => {
    const { id, seqId, ...rest } = item;
    return {
      ...rest,
      children: stripMetadataFromOutline(item.children)
    };
  });
}

/**
 * Truncate text to a maximum length with ellipsis.
 *
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
