/**
 * Edit Merge - Multi-agent edit file merging and conflict resolution.
 *
 * This module merges edit files from multiple sub-agents, detects conflicts,
 * and produces a single unified edit file ready for application.
 *
 * Key Features:
 * - Merge edits from multiple sources
 * - Detect when same block is edited by multiple agents
 * - Apply conflict resolution strategies
 * - Validate merged edits against document IR
 * - Sort edits for safe application order
 */
import { readFile, writeFile } from 'fs/promises';

/**
 * @typedef {'error'|'first'|'last'|'combine'} ConflictStrategy
 * - 'error': Fail if same block is edited by multiple sub-agents
 * - 'first': Keep first edit encountered (by file order)
 * - 'last': Keep last edit encountered (by file order)
 * - 'combine': For comments, combine them; for other ops, use 'first'
 */

/**
 * @typedef {Object} MergeOptions
 * @property {ConflictStrategy} conflictStrategy - How to handle conflicts
 * @property {boolean} preserveOrder - Maintain relative order within each file (default: true)
 * @property {string} outputPath - Optional path to write merged edits
 */

/**
 * @typedef {Object} Conflict
 * @property {string} blockId - The block ID with conflicting edits
 * @property {Array<Edit>} edits - The conflicting edits
 * @property {'first'|'last'|'combined'|null} resolution - How the conflict was resolved
 */

/**
 * @typedef {Object} MergeResult
 * @property {boolean} success - Whether merge completed without fatal errors
 * @property {string} [error] - Error message if success is false
 * @property {MergedEditFile|null} merged - The merged edit file
 * @property {Conflict[]} conflicts - All conflicts detected
 * @property {MergeStats} stats - Statistics about the merge
 */

/**
 * @typedef {Object} MergeStats
 * @property {number} totalEdits - Total edits in merged output
 * @property {number} sourceFiles - Number of source files merged
 * @property {number} conflictsDetected - Number of conflicts detected
 */

/**
 * @typedef {Object} MergedEditFile
 * @property {string} version - Version string '0.2.0'
 * @property {MergeInfo} _mergeInfo - Merge metadata
 * @property {Edit[]} edits - Merged array of edits
 */

/**
 * @typedef {Object} MergeInfo
 * @property {string[]} sourceFiles - Paths to source edit files
 * @property {string} mergedAt - ISO timestamp of merge
 * @property {string} conflictStrategy - Strategy used for conflicts
 * @property {number} conflictsResolved - Number of conflicts that were resolved
 */

/**
 * Merge multiple edit files from sub-agents into a single edit file.
 * Detects conflicts and resolves ordering issues.
 *
 * @param {string[]} editFilePaths - Paths to edit JSON files from sub-agents
 * @param {MergeOptions} options - Merge options
 * @returns {Promise<MergeResult>}
 */
export async function mergeEditFiles(editFilePaths, options = {}) {
  const {
    conflictStrategy = 'error',
    preserveOrder = true,
    outputPath = null
  } = options;

  const allEdits = [];
  const conflicts = [];
  const editsByBlockId = new Map();

  // Load and collect all edits
  for (let fileIndex = 0; fileIndex < editFilePaths.length; fileIndex++) {
    const filePath = editFilePaths[fileIndex];

    let content;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      return {
        success: false,
        error: `Failed to read edit file: ${filePath} - ${err.message}`,
        merged: null,
        conflicts: [],
        stats: { totalEdits: 0, sourceFiles: 0, conflictsDetected: 0 }
      };
    }

    let editFile;
    try {
      editFile = JSON.parse(content);
    } catch (err) {
      return {
        success: false,
        error: `Failed to parse JSON in: ${filePath} - ${err.message}`,
        merged: null,
        conflicts: [],
        stats: { totalEdits: 0, sourceFiles: 0, conflictsDetected: 0 }
      };
    }

    // Ensure edits array exists
    if (!editFile.edits || !Array.isArray(editFile.edits)) {
      return {
        success: false,
        error: `Invalid edit file format: ${filePath} - missing edits array`,
        merged: null,
        conflicts: [],
        stats: { totalEdits: 0, sourceFiles: 0, conflictsDetected: 0 }
      };
    }

    for (let editIndex = 0; editIndex < editFile.edits.length; editIndex++) {
      const edit = { ...editFile.edits[editIndex] };
      const blockId = edit.blockId || edit.afterBlockId;

      // Track source for debugging
      edit._source = {
        file: filePath,
        fileIndex,
        editIndex
      };

      // Check for conflicts
      if (editsByBlockId.has(blockId)) {
        const existing = editsByBlockId.get(blockId);
        const conflict = {
          blockId,
          edits: [existing, edit],
          resolution: null
        };
        conflicts.push(conflict);

        // Handle based on strategy
        if (conflictStrategy === 'error') {
          // Will be reported in result - don't add the conflicting edit
          continue;
        } else if (conflictStrategy === 'first') {
          // Keep existing, skip new
          conflict.resolution = 'first';
          continue;
        } else if (conflictStrategy === 'last') {
          // Replace existing with new
          const idx = allEdits.findIndex(e =>
            (e.blockId || e.afterBlockId) === blockId
          );
          if (idx !== -1) {
            allEdits[idx] = edit;
          }
          editsByBlockId.set(blockId, edit);
          conflict.resolution = 'last';
          continue;
        } else if (conflictStrategy === 'combine') {
          // Special handling for comments
          if (edit.operation === 'comment' && existing.operation === 'comment') {
            // Combine comments with separator
            existing.comment = `${existing.comment}\n\n---\n\n${edit.comment}`;
            conflict.resolution = 'combined';
            continue;
          }
          // For non-comment operations, use 'first' behavior
          conflict.resolution = 'first';
          continue;
        }
      }

      editsByBlockId.set(blockId, edit);
      allEdits.push(edit);
    }
  }

  // Check for error strategy with conflicts
  if (conflictStrategy === 'error' && conflicts.length > 0) {
    return {
      success: false,
      error: `${conflicts.length} conflict(s) detected. Use a different conflictStrategy or resolve manually.`,
      conflicts,
      merged: null,
      stats: {
        totalEdits: 0,
        sourceFiles: editFilePaths.length,
        conflictsDetected: conflicts.length
      }
    };
  }

  // Build merged edit file
  const merged = {
    version: '0.2.0',
    _mergeInfo: {
      sourceFiles: editFilePaths,
      mergedAt: new Date().toISOString(),
      conflictStrategy,
      conflictsResolved: conflicts.length
    },
    edits: allEdits.map(e => {
      // Remove internal tracking
      const { _source, ...cleanEdit } = e;
      return cleanEdit;
    })
  };

  // Optionally write to file
  if (outputPath) {
    try {
      await writeFile(outputPath, JSON.stringify(merged, null, 2));
    } catch (err) {
      return {
        success: false,
        error: `Failed to write merged file: ${outputPath} - ${err.message}`,
        merged: null,
        conflicts,
        stats: {
          totalEdits: allEdits.length,
          sourceFiles: editFilePaths.length,
          conflictsDetected: conflicts.length
        }
      };
    }
  }

  return {
    success: true,
    merged,
    conflicts,
    stats: {
      totalEdits: allEdits.length,
      sourceFiles: editFilePaths.length,
      conflictsDetected: conflicts.length
    }
  };
}

/**
 * Merge edit objects directly (without reading from files).
 * Useful for programmatic merging in tests or when edits are already in memory.
 *
 * @param {EditFile[]} editFiles - Array of edit file objects
 * @param {MergeOptions} options - Merge options
 * @returns {MergeResult}
 */
export function mergeEdits(editFiles, options = {}) {
  const {
    conflictStrategy = 'error',
    preserveOrder = true
  } = options;

  const allEdits = [];
  const conflicts = [];
  const editsByBlockId = new Map();

  for (let fileIndex = 0; fileIndex < editFiles.length; fileIndex++) {
    const editFile = editFiles[fileIndex];
    const edits = editFile.edits || [];

    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
      const edit = { ...edits[editIndex] };
      const blockId = edit.blockId || edit.afterBlockId;

      // Track source for debugging
      edit._source = {
        fileIndex,
        editIndex
      };

      // Check for conflicts
      if (editsByBlockId.has(blockId)) {
        const existing = editsByBlockId.get(blockId);
        const conflict = {
          blockId,
          edits: [existing, edit],
          resolution: null
        };
        conflicts.push(conflict);

        if (conflictStrategy === 'error') {
          continue;
        } else if (conflictStrategy === 'first') {
          conflict.resolution = 'first';
          continue;
        } else if (conflictStrategy === 'last') {
          const idx = allEdits.findIndex(e =>
            (e.blockId || e.afterBlockId) === blockId
          );
          if (idx !== -1) {
            allEdits[idx] = edit;
          }
          editsByBlockId.set(blockId, edit);
          conflict.resolution = 'last';
          continue;
        } else if (conflictStrategy === 'combine') {
          if (edit.operation === 'comment' && existing.operation === 'comment') {
            existing.comment = `${existing.comment}\n\n---\n\n${edit.comment}`;
            conflict.resolution = 'combined';
            continue;
          }
          conflict.resolution = 'first';
          continue;
        }
      }

      editsByBlockId.set(blockId, edit);
      allEdits.push(edit);
    }
  }

  if (conflictStrategy === 'error' && conflicts.length > 0) {
    return {
      success: false,
      error: `${conflicts.length} conflict(s) detected. Use a different conflictStrategy or resolve manually.`,
      conflicts,
      merged: null,
      stats: {
        totalEdits: 0,
        sourceFiles: editFiles.length,
        conflictsDetected: conflicts.length
      }
    };
  }

  const merged = {
    version: '0.2.0',
    _mergeInfo: {
      mergedAt: new Date().toISOString(),
      conflictStrategy,
      conflictsResolved: conflicts.length
    },
    edits: allEdits.map(e => {
      const { _source, ...cleanEdit } = e;
      return cleanEdit;
    })
  };

  return {
    success: true,
    merged,
    conflicts,
    stats: {
      totalEdits: allEdits.length,
      sourceFiles: editFiles.length,
      conflictsDetected: conflicts.length
    }
  };
}

/**
 * @typedef {Object} ValidationIssue
 * @property {number} editIndex - Index of the problematic edit
 * @property {'missing_block'|'delete_then_reference'|'invalid_operation'} type
 * @property {string} blockId - The block ID involved
 * @property {string} message - Human-readable description
 */

/**
 * @typedef {Object} MergeValidationResult
 * @property {boolean} valid - True if no issues found
 * @property {ValidationIssue[]} issues - Array of detected issues
 */

/**
 * Validate that edits from multiple sub-agents don't have logical conflicts.
 * More thorough than basic merge - checks for semantic issues.
 *
 * @param {Object} mergedEdits - Merged edit file
 * @param {DocumentIR} ir - Document IR for validation
 * @returns {MergeValidationResult}
 */
export function validateMergedEdits(mergedEdits, ir) {
  const issues = [];
  const blockIdSet = new Set(ir.blocks.map(b => b.id));
  const seqIdSet = new Set(ir.blocks.map(b => b.seqId));

  // Track deleted blocks for detecting delete-then-reference conflicts
  const deletedBlocks = new Set();

  for (let i = 0; i < mergedEdits.edits.length; i++) {
    const edit = mergedEdits.edits[i];
    const blockId = edit.blockId || edit.afterBlockId;

    // Check if block exists in document
    if (!blockIdSet.has(blockId) && !seqIdSet.has(blockId)) {
      issues.push({
        editIndex: i,
        type: 'missing_block',
        blockId,
        message: `Block ${blockId} not found in document`
      });
      continue;
    }

    // Track deletes
    if (edit.operation === 'delete') {
      deletedBlocks.add(blockId);
    }

    // Check for reference to already-deleted block
    if (deletedBlocks.has(blockId) && edit.operation !== 'delete') {
      issues.push({
        editIndex: i,
        type: 'delete_then_reference',
        blockId,
        message: `Block ${blockId} is referenced after being deleted`
      });
      continue;
    }

    // Check for afterBlockId referencing a deleted block
    if (edit.afterBlockId && deletedBlocks.has(edit.afterBlockId)) {
      issues.push({
        editIndex: i,
        type: 'delete_then_reference',
        blockId: edit.afterBlockId,
        message: `Block ${edit.afterBlockId} is used as insertion anchor but was deleted`
      });
      continue;
    }

    // Check for delete then reference (looking ahead in edits)
    if (edit.operation === 'delete') {
      const laterEdits = mergedEdits.edits.slice(i + 1);
      const laterRef = laterEdits.find(e =>
        e.afterBlockId === blockId ||
        (e.operation === 'replace' && e.blockId === blockId) ||
        (e.operation === 'comment' && e.blockId === blockId)
      );
      if (laterRef) {
        issues.push({
          editIndex: i,
          type: 'delete_then_reference',
          blockId,
          message: `Block ${blockId} is deleted but referenced by later edit`
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Sort edits for optimal application order.
 * Edits should be applied from end of document to start
 * to prevent position shifts from affecting later edits.
 *
 * @param {Object[]} edits - Array of edit objects
 * @param {DocumentIR} ir - Document IR for position lookup
 * @returns {Object[]} - Sorted edits (descending by position)
 */
export function sortEditsForApplication(edits, ir) {
  // Build position lookup
  const positionMap = new Map();
  for (const block of ir.blocks) {
    positionMap.set(block.id, block.startPos);
    positionMap.set(block.seqId, block.startPos);
  }

  // Sort by position descending (end of document first)
  return [...edits].sort((a, b) => {
    const posA = positionMap.get(a.blockId || a.afterBlockId) || 0;
    const posB = positionMap.get(b.blockId || b.afterBlockId) || 0;
    return posB - posA; // Descending
  });
}

/**
 * Analyze conflicts in a set of edit files without merging.
 * Useful for reporting potential issues before attempting merge.
 *
 * @param {string[]} editFilePaths - Paths to edit files
 * @returns {Promise<ConflictAnalysis>}
 *
 * @typedef {Object} ConflictAnalysis
 * @property {boolean} hasConflicts
 * @property {Conflict[]} conflicts
 * @property {Object.<string, number>} editCountsByBlock - Number of edits per block
 */
export async function analyzeConflicts(editFilePaths) {
  const editsByBlockId = new Map();
  const conflicts = [];

  for (let fileIndex = 0; fileIndex < editFilePaths.length; fileIndex++) {
    const filePath = editFilePaths[fileIndex];

    let content;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      continue; // Skip unreadable files in analysis
    }

    let editFile;
    try {
      editFile = JSON.parse(content);
    } catch (err) {
      continue; // Skip unparseable files in analysis
    }

    if (!editFile.edits || !Array.isArray(editFile.edits)) {
      continue;
    }

    for (const edit of editFile.edits) {
      const blockId = edit.blockId || edit.afterBlockId;

      if (!editsByBlockId.has(blockId)) {
        editsByBlockId.set(blockId, []);
      }
      editsByBlockId.get(blockId).push({
        ...edit,
        _source: { file: filePath, fileIndex }
      });
    }
  }

  // Find blocks with multiple edits
  for (const [blockId, edits] of editsByBlockId) {
    if (edits.length > 1) {
      conflicts.push({
        blockId,
        edits,
        resolution: null
      });
    }
  }

  // Build counts
  const editCountsByBlock = {};
  for (const [blockId, edits] of editsByBlockId) {
    editCountsByBlock[blockId] = edits.length;
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    editCountsByBlock
  };
}

/**
 * Create an empty edit file structure.
 * Useful for sub-agents to start with a valid template.
 *
 * @param {Object} options - Options for the edit file
 * @param {string} [options.agentId] - ID of the sub-agent
 * @param {string} [options.assignedRange] - Block range assigned to this agent
 * @returns {Object} - Empty edit file structure
 */
export function createEmptyEditFile(options = {}) {
  const { agentId, assignedRange } = options;

  return {
    version: '0.2.0',
    _agentInfo: {
      agentId: agentId || null,
      assignedRange: assignedRange || null,
      createdAt: new Date().toISOString()
    },
    edits: []
  };
}

/**
 * Split a document's blocks into ranges for parallel agent processing.
 * Returns suggested ranges that can be assigned to sub-agents.
 *
 * @param {DocumentIR} ir - Document IR
 * @param {number} numAgents - Number of sub-agents to split work between
 * @param {Object} options - Split options
 * @param {boolean} [options.respectHeadings] - Try to split at heading boundaries
 * @returns {BlockRange[]}
 *
 * @typedef {Object} BlockRange
 * @property {number} agentIndex - Which agent this range is for (0-indexed)
 * @property {string} startSeqId - First block seqId in range
 * @property {string} endSeqId - Last block seqId in range
 * @property {number} blockCount - Number of blocks in range
 */
export function splitBlocksForAgents(ir, numAgents, options = {}) {
  const { respectHeadings = true } = options;
  const blocks = ir.blocks;

  if (blocks.length === 0 || numAgents <= 0) {
    return [];
  }

  if (numAgents === 1) {
    return [{
      agentIndex: 0,
      startSeqId: blocks[0].seqId,
      endSeqId: blocks[blocks.length - 1].seqId,
      blockCount: blocks.length
    }];
  }

  const ranges = [];
  const targetBlocksPerAgent = Math.ceil(blocks.length / numAgents);

  let currentStart = 0;
  for (let agent = 0; agent < numAgents; agent++) {
    let currentEnd = Math.min(currentStart + targetBlocksPerAgent - 1, blocks.length - 1);

    // If respecting headings, try to find a heading boundary
    if (respectHeadings && agent < numAgents - 1) {
      // Look forward for a heading within a reasonable range
      const lookAheadLimit = Math.min(currentEnd + 10, blocks.length - 1);
      for (let i = currentEnd + 1; i <= lookAheadLimit; i++) {
        if (blocks[i].type === 'heading') {
          currentEnd = i - 1;
          break;
        }
      }
    }

    // Handle last agent getting remaining blocks
    if (agent === numAgents - 1) {
      currentEnd = blocks.length - 1;
    }

    if (currentStart <= currentEnd) {
      ranges.push({
        agentIndex: agent,
        startSeqId: blocks[currentStart].seqId,
        endSeqId: blocks[currentEnd].seqId,
        blockCount: currentEnd - currentStart + 1
      });
    }

    currentStart = currentEnd + 1;
    if (currentStart >= blocks.length) {
      break;
    }
  }

  return ranges;
}
