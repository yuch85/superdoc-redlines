#!/usr/bin/env node

/**
 * superdoc-redline.mjs v0.2.0
 *
 * Structured document operations for AI agents.
 * Uses ID-based block editing for deterministic, position-independent edits.
 *
 * Commands:
 *   extract  - Extract structured intermediate representation from DOCX
 *   read     - Read document for LLM consumption (with automatic chunking)
 *   validate - Validate edit instructions against a document
 *   apply    - Apply ID-based edits to a document
 *   merge    - Merge edit files from multiple sub-agents
 *
 * Usage:
 *   node superdoc-redline.mjs extract --input doc.docx --output ir.json
 *   node superdoc-redline.mjs read --input doc.docx [--chunk N]
 *   node superdoc-redline.mjs validate --input doc.docx --edits edits.json
 *   node superdoc-redline.mjs apply --input doc.docx --output out.docx --edits edits.json
 *   node superdoc-redline.mjs merge edits1.json edits2.json --output merged.json
 */

import { program } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { extractDocumentIR } from './src/irExtractor.mjs';
import { readDocument, getDocumentStats } from './src/documentReader.mjs';
import { applyEdits, validateEdits } from './src/editApplicator.mjs';
import { mergeEditFiles, validateMergedEdits } from './src/editMerge.mjs';
import { parseMarkdownEdits, editsToMarkdown } from './src/markdownEditsParser.mjs';

/**
 * Parse integer argument for Commander.js options.
 * Commander passes (value, previousValue) to parsers, but parseInt expects (string, radix).
 * Using parseInt directly causes bugs when a default value exists (previousValue becomes radix).
 * @param {string} value - The CLI argument value
 * @returns {number}
 */
const parseIntArg = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
};

program
  .name('superdoc-redline')
  .description('Structured document operations for AI agents')
  .version('0.2.0');

// ============================================================================
// Command: extract
// ============================================================================

program
  .command('extract')
  .description('Extract structured intermediate representation from a DOCX file')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .option('-o, --output <path>', 'Output JSON file (default: <input>-ir.json)')
  .option('-f, --format <type>', 'Output format: full|outline|blocks', 'full')
  .option('--no-defined-terms', 'Exclude defined terms extraction')
  .option('--max-text <length>', 'Truncate block text to length', parseIntArg)
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      const outputPath = options.output
        ? resolve(options.output)
        : inputPath.replace('.docx', '-ir.json');

      console.log(`Extracting IR from: ${inputPath}`);

      const ir = await extractDocumentIR(inputPath, {
        format: options.format,
        includeDefinedTerms: options.definedTerms !== false,
        maxTextLength: options.maxText || null
      });

      await writeFile(outputPath, JSON.stringify(ir, null, 2));

      console.log(`\nExtraction complete:`);
      console.log(`  Blocks: ${ir.blocks.length}`);
      console.log(`  Format: ${ir.metadata.format}`);
      if (ir.outline) {
        console.log(`  Outline items: ${countOutlineItems(ir.outline)}`);
      }
      if (ir.definedTerms) {
        console.log(`  Defined terms: ${Object.keys(ir.definedTerms).length}`);
      }
      console.log(`  Output: ${outputPath}`);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: read
// ============================================================================

program
  .command('read')
  .description('Read document for LLM consumption (with automatic chunking)')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .option('-c, --chunk <index>', 'Specific chunk index (0-indexed)', parseIntArg)
  .option('--max-tokens <count>', 'Max tokens per chunk', parseIntArg, 100000)
  .option('-f, --format <type>', 'Output format: full|outline|summary', 'full')
  .option('--stats-only', 'Only show document statistics')
  .option('--no-metadata', 'Exclude block IDs and positions from output')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);

      if (options.statsOnly) {
        const stats = await getDocumentStats(inputPath, {
          maxTokens: options.maxTokens
        });
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      const result = await readDocument(inputPath, {
        chunkIndex: options.chunk ?? null,
        maxTokens: options.maxTokens,
        format: options.format,
        includeMetadata: options.metadata !== false
      });

      if (!result.success) {
        console.error('Error:', result.error);
        process.exit(1);
      }

      // Output as JSON for LLM consumption
      console.log(JSON.stringify(result, null, 2));

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: validate
// ============================================================================

program
  .command('validate')
  .description('Validate edit instructions against a document')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .requiredOption('-e, --edits <path>', 'Edits JSON file')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      const editsPath = resolve(options.edits);

      const editsJson = await readFile(editsPath, 'utf-8');
      const edits = JSON.parse(editsJson);

      const result = await validateEdits(inputPath, edits);

      console.log(JSON.stringify(result, null, 2));

      if (!result.valid) {
        process.exit(1);
      }

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: apply
// ============================================================================

program
  .command('apply')
  .description('Apply ID-based edits to a document')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .requiredOption('-o, --output <path>', 'Output DOCX file')
  .requiredOption('-e, --edits <path>', 'Edits JSON file')
  .option('--author-name <name>', 'Author name for track changes', 'AI Assistant')
  .option('--author-email <email>', 'Author email', 'ai@example.com')
  .option('--no-track-changes', 'Disable track changes mode')
  .option('--no-validate', 'Skip validation before applying')
  .option('--no-sort', 'Skip automatic edit sorting')
  .option('-v, --verbose', 'Enable verbose logging for debugging position mapping')
  .option('--strict', 'Treat truncation warnings as errors')
  .option('--skip-invalid', 'Skip invalid edits instead of failing')
  .option('-q, --quiet-warnings', 'Suppress content reduction warnings')
  .option('--allow-reduction', 'Allow intentional content reduction without warnings (for jurisdiction conversions)')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      const outputPath = resolve(options.output);
      const editsPath = resolve(options.edits);

      // Auto-detect format by extension
      let editConfig;
      if (options.edits.endsWith('.md')) {
        const markdown = await readFile(editsPath, 'utf-8');
        editConfig = parseMarkdownEdits(markdown);
      } else {
        const editsJson = await readFile(editsPath, 'utf-8');
        editConfig = JSON.parse(editsJson);
      }

      console.log(`Loading document: ${inputPath}`);
      console.log(`Applying ${editConfig.edits.length} edit(s)...`);

      const result = await applyEdits(inputPath, outputPath, editConfig, {
        trackChanges: options.trackChanges !== false,
        validateFirst: options.validate !== false,
        sortEdits: options.sort !== false,
        verbose: options.verbose || false,
        strict: options.strict || false,
        skipInvalid: options.skipInvalid || false,
        allowReduction: options.allowReduction || false,
        author: {
          name: options.authorName,
          email: options.authorEmail
        }
      });

      console.log(`\nResults:`);
      console.log(`  Applied: ${result.applied}`);
      console.log(`  Skipped: ${result.skipped.length}`);

      // Show warnings if any (unless --quiet-warnings)
      if (result.warnings && result.warnings.length > 0) {
        console.log(`  Warnings: ${result.warnings.length}`);
        if (!options.quietWarnings) {
          console.log(`\nWarnings (possible truncation/corruption):`);
          for (const warn of result.warnings) {
            console.log(`  [${warn.editIndex}] ${warn.blockId} - ${warn.message}`);
          }
        }
      }

      if (result.skipped.length > 0) {
        console.log(`\nSkipped edits:`);
        for (const skip of result.skipped) {
          console.log(`  [${skip.index}] ${skip.blockId} - ${skip.reason}`);
        }
      }

      if (result.comments && result.comments.length > 0) {
        console.log(`\nComments added: ${result.comments.length}`);
      }

      console.log(`\nOutput: ${outputPath}`);

      // Exit with error if any edits were skipped (unless --skip-invalid mode)
      if (result.skipped.length > 0 && !options.skipInvalid) {
        process.exit(1);
      }

      // In strict mode, warnings are also errors
      if (options.strict && result.warnings && result.warnings.length > 0) {
        console.error('\nStrict mode: treating warnings as errors');
        process.exit(1);
      }

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: merge
// ============================================================================

program
  .command('merge')
  .description('Merge edit files from multiple sub-agents')
  .requiredOption('-o, --output <path>', 'Output merged edits file')
  .option('-c, --conflict <strategy>', 'Conflict strategy: error|first|last|combine', 'error')
  .option('-n, --normalize', 'Normalize field names from common variants (type→operation, etc.)')
  .option('-v, --validate <docx>', 'Validate merged edits against document')
  .argument('<files...>', 'Edit files to merge')
  .action(async (files, options) => {
    try {
      const editPaths = files.map(f => resolve(f));

      console.log(`Merging ${editPaths.length} edit file(s)...`);

      const result = await mergeEditFiles(editPaths, {
        conflictStrategy: options.conflict,
        normalize: options.normalize || false,
        outputPath: resolve(options.output)
      });

      if (!result.success) {
        console.error('Merge failed:', result.error);
        if (result.conflicts && result.conflicts.length > 0) {
          console.log('\nConflicts:');
          for (const conflict of result.conflicts) {
            console.log(`  Block ${conflict.blockId}: ${conflict.edits.length} conflicting edits`);
          }
        }
        process.exit(1);
      }

      console.log(`\nMerge complete:`);
      console.log(`  Total edits: ${result.stats.totalEdits}`);
      console.log(`  Source files: ${result.stats.sourceFiles}`);
      if (result.stats.conflictsDetected > 0) {
        console.log(`  Conflicts resolved: ${result.stats.conflictsDetected}`);
      }
      console.log(`  Output: ${options.output}`);

      // Optional validation against document
      if (options.validate) {
        console.log(`\nValidating against: ${options.validate}`);

        const ir = await extractDocumentIR(resolve(options.validate));
        const validation = validateMergedEdits(result.merged, ir);

        if (!validation.valid) {
          console.log('\nValidation issues:');
          for (const issue of validation.issues) {
            console.log(`  [${issue.editIndex}] ${issue.type}: ${issue.message}`);
          }
          process.exit(1);
        }

        console.log('Validation: PASSED');
      }

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: parse-edits
// ============================================================================

program
  .command('parse-edits')
  .description('Convert markdown edits to JSON format')
  .requiredOption('-i, --input <file>', 'Input markdown file (.md)')
  .requiredOption('-o, --output <file>', 'Output JSON file (.json)')
  .option('--validate <docx>', 'Validate block IDs against document')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      const outputPath = resolve(options.output);

      const markdown = await readFile(inputPath, 'utf-8');
      const editConfig = parseMarkdownEdits(markdown);

      // Optional validation against document
      if (options.validate) {
        const ir = await extractDocumentIR(resolve(options.validate));
        const validBlockIds = new Set(ir.blocks.map(block => block.id));

        const invalidEdits = [];
        for (let i = 0; i < editConfig.edits.length; i++) {
          const edit = editConfig.edits[i];
          if (edit.type === 'insert') {
            if (edit.afterBlockId && !validBlockIds.has(edit.afterBlockId)) {
              invalidEdits.push({ index: i, blockId: edit.afterBlockId, type: 'afterBlockId' });
            }
          } else {
            if (!validBlockIds.has(edit.blockId)) {
              invalidEdits.push({ index: i, blockId: edit.blockId, type: 'blockId' });
            }
          }
        }

        if (invalidEdits.length > 0) {
          console.error('Validation failed. Invalid block IDs:');
          for (const invalid of invalidEdits) {
            console.error(`  [${invalid.index}] ${invalid.type}: ${invalid.blockId}`);
          }
          process.exit(1);
        }
      }

      await writeFile(outputPath, JSON.stringify(editConfig, null, 2));
      console.log(`Converted ${editConfig.edits.length} edits to ${outputPath}`);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: to-markdown
// ============================================================================

program
  .command('to-markdown')
  .description('Convert JSON edits to markdown format')
  .requiredOption('-i, --input <file>', 'Input JSON file (.json)')
  .requiredOption('-o, --output <file>', 'Output markdown file (.md)')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      const outputPath = resolve(options.output);

      const editsJson = await readFile(inputPath, 'utf-8');
      const editConfig = JSON.parse(editsJson);

      const markdown = editsToMarkdown(editConfig);

      await writeFile(outputPath, markdown);
      console.log(`Converted ${editConfig.edits.length} edits to ${outputPath}`);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Command: find-block
// ============================================================================

program
  .command('find-block')
  .description('Find blocks by text content')
  .requiredOption('-i, --input <path>', 'Input DOCX file or IR JSON file')
  .option('-t, --text <text>', 'Text to search for (case-insensitive)')
  .option('-r, --regex <pattern>', 'Regex pattern to search for')
  .option('-c, --context <chars>', 'Context characters to show around match', parseIntArg, 50)
  .option('--max-results <count>', 'Maximum number of results', parseIntArg, 20)
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);

      // Determine if input is IR JSON or DOCX
      let ir;
      if (options.input.endsWith('.json')) {
        const irJson = await readFile(inputPath, 'utf-8');
        ir = JSON.parse(irJson);
      } else {
        ir = await extractDocumentIR(inputPath, { format: 'full' });
      }

      // Build search pattern
      let searchFn;
      if (options.regex) {
        const regex = new RegExp(options.regex, 'gi');
        searchFn = (text) => regex.test(text);
      } else if (options.text) {
        const lowerText = options.text.toLowerCase();
        searchFn = (text) => text.toLowerCase().includes(lowerText);
      } else {
        console.error('Error: Either --text or --regex is required');
        process.exit(1);
      }

      // Search blocks
      const results = [];
      for (const block of ir.blocks) {
        if (searchFn(block.text || '')) {
          results.push({
            seqId: block.seqId,
            id: block.id,
            type: block.type,
            text: block.text,
            preview: truncateWithContext(
              block.text,
              options.text || options.regex,
              options.context
            )
          });

          if (results.length >= options.maxResults) {
            break;
          }
        }
      }

      // Output results
      if (results.length === 0) {
        console.log('No blocks found matching the search criteria.');
      } else {
        console.log(`Found ${results.length} block(s):\n`);
        for (const result of results) {
          console.log(`[${result.seqId}] (${result.type})`);
          console.log(`  ID: ${result.id}`);
          console.log(`  Preview: ${result.preview}`);
          console.log('');
        }
      }

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * Truncate text showing context around a search term.
 * @param {string} text - Full text
 * @param {string} searchTerm - Term to find context around
 * @param {number} contextChars - Characters to show on each side
 * @returns {string}
 */
function truncateWithContext(text, searchTerm, contextChars) {
  if (!text) return '';

  // Find the search term position (case-insensitive)
  const lowerText = text.toLowerCase();
  const lowerTerm = searchTerm?.toLowerCase() || '';
  const idx = lowerText.indexOf(lowerTerm);

  if (idx === -1 || !searchTerm) {
    // No match found, just truncate from start
    if (text.length <= contextChars * 2) return text;
    return text.slice(0, contextChars * 2) + '...';
  }

  // Calculate context window
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + searchTerm.length + contextChars);

  let preview = '';
  if (start > 0) preview += '...';
  preview += text.slice(start, end);
  if (end < text.length) preview += '...';

  return preview.replace(/\n/g, ' ');
}

// ============================================================================
// Command: recompress
// ============================================================================

program
  .command('recompress')
  .description('Recompress a DOCX file to reduce file size (SuperDoc writes uncompressed)')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .option('-o, --output <path>', 'Output DOCX file (default: overwrites input)')
  .action(async (options) => {
    try {
      const { createReadStream, createWriteStream, unlinkSync, renameSync, statSync } = await import('fs');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const { promisify } = await import('util');
      const { pipeline } = await import('stream');
      const pipelineAsync = promisify(pipeline);

      // Use dynamic import for archiver and unzipper
      let archiver, unzipper;
      try {
        archiver = (await import('archiver')).default;
        unzipper = await import('unzipper');
      } catch (e) {
        console.error('Error: recompress requires archiver and unzipper packages.');
        console.error('Install with: npm install archiver unzipper');
        process.exit(1);
      }

      const inputPath = resolve(options.input);
      const outputPath = options.output ? resolve(options.output) : inputPath;
      const tempDir = join(tmpdir(), `docx-recompress-${Date.now()}`);
      const tempZip = join(tmpdir(), `docx-recompress-${Date.now()}.docx`);

      // Get original size
      const originalSize = statSync(inputPath).size;
      console.log(`Recompressing: ${inputPath}`);
      console.log(`  Original size: ${(originalSize / 1024).toFixed(1)} KB`);

      // Extract DOCX to temp directory
      const { mkdir, rm } = await import('fs/promises');
      await mkdir(tempDir, { recursive: true });

      await pipelineAsync(
        createReadStream(inputPath),
        unzipper.Extract({ path: tempDir })
      );

      // Create new compressed DOCX
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      const outputStream = createWriteStream(tempZip);

      await new Promise((resolve, reject) => {
        outputStream.on('close', resolve);
        outputStream.on('error', reject);
        archive.on('error', reject);

        archive.pipe(outputStream);
        archive.directory(tempDir, false);
        archive.finalize();
      });

      // Get compressed size
      const compressedSize = statSync(tempZip).size;
      const reduction = Math.round((1 - compressedSize / originalSize) * 100);

      // Move temp file to output
      if (outputPath === inputPath) {
        unlinkSync(inputPath);
      }
      renameSync(tempZip, outputPath);

      // Cleanup temp directory
      await rm(tempDir, { recursive: true, force: true });

      console.log(`  Compressed size: ${(compressedSize / 1024).toFixed(1)} KB`);
      console.log(`  Reduction: ${reduction}%`);
      console.log(`  Output: ${outputPath}`);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Count total outline items including nested children.
 * @param {OutlineItem[]} outline - Outline array
 * @returns {number}
 */
function countOutlineItems(outline) {
  if (!outline) return 0;
  let count = 0;
  for (const item of outline) {
    count++;
    if (item.children) {
      count += countOutlineItems(item.children);
    }
  }
  return count;
}

// Parse and run
program.parse();
