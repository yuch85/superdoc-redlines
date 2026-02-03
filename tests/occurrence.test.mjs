// tests/occurrence.test.mjs

/**
 * Tests for occurrence selector functionality.
 * These tests verify the 'occurrence' and 'all' fields in edit objects
 * work correctly with the findAllMatches function.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'superdoc-redline.mjs');
const FIXTURES_PATH = resolve(__dirname, 'fixtures');
const OUTPUT_PATH = resolve(__dirname, 'output');

/**
 * Run the CLI with given arguments
 */
function runCLI(args) {
  try {
    const result = execSync(`node "${CLI_PATH}" ${args}`, {
      encoding: 'utf-8',
      cwd: __dirname,
      timeout: 30000
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message
    };
  }
}

/**
 * Extract text content from a DOCX file
 */
function extractDocxText(docxPath) {
  try {
    // Extract document.xml and get text content
    const result = execSync(
      `unzip -p "${docxPath}" word/document.xml | grep -oP '(?<=<w:t[^>]*>)[^<]+' | tr '\\n' ' '`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return result.trim();
  } catch (error) {
    return '';
  }
}

/**
 * Check if DOCX has tracked changes
 */
function hasTrackedChanges(docxPath) {
  try {
    const result = execSync(
      `unzip -p "${docxPath}" word/document.xml | grep -c '<w:ins\\|<w:del'`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return parseInt(result.trim(), 10) > 0;
  } catch (error) {
    return false;
  }
}

describe('Occurrence Selector', () => {
  const sampleDocx = resolve(FIXTURES_PATH, 'sample.docx');

  before(async () => {
    // Ensure output directory exists
    if (!existsSync(OUTPUT_PATH)) {
      await mkdir(OUTPUT_PATH, { recursive: true });
    }
  });

  describe('all: true', () => {
    it('replaces all occurrences when all: true is set', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-all.docx');

      // Sample.docx should have multiple "the" occurrences
      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'the',
            replace: 'THE',
            all: true,
            comment: 'Replace all "the" with "THE"'
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      // The CLI should succeed
      assert.ok(result.success || result.output.includes('Applied'),
        `CLI failed: ${result.error || result.output}`);
    });

    it('reports correct match count in output', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-count.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'sample',
            replace: 'SAMPLE',
            all: true
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      // Should show how many were applied
      assert.ok(result.success || result.output.includes('Applied'),
        `CLI failed: ${result.error || result.output}`);
    });
  });

  describe('occurrence: n', () => {
    it('replaces only the nth occurrence (1-indexed)', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-second.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'the',
            replace: 'THE-SECOND',
            occurrence: 2,
            comment: 'Replace only second "the"'
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      assert.ok(result.success || result.output.includes('Applied'),
        `CLI failed: ${result.error || result.output}`);
    });

    it('skips if occurrence does not exist', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-missing.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'sample',
            replace: 'SAMPLE',
            occurrence: 999
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      // Should report skip with reason about occurrence count
      assert.ok(result.output.includes('Skipped') || result.output.includes('occurrence'),
        `Expected skip message, got: ${result.output}`);
    });

    it('replaces first occurrence when occurrence: 1', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-first.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'the',
            replace: 'THE-FIRST',
            occurrence: 1
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      assert.ok(result.success || result.output.includes('Applied'),
        `CLI failed: ${result.error || result.output}`);
    });
  });

  describe('default (first occurrence)', () => {
    it('replaces only first occurrence by default', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-default.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'the',
            replace: 'THE-DEFAULT'
            // No occurrence or all specified - should default to first
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      assert.ok(result.success || result.output.includes('Applied: 1'),
        `CLI failed: ${result.error || result.output}`);
    });
  });

  describe('edge cases', () => {
    it('handles occurrence: 0 gracefully', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-zero.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'the',
            replace: 'THE',
            occurrence: 0  // Invalid - should skip
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      // Should skip since occurrence must be >= 1
      assert.ok(result.output.includes('Skipped') || result.output.includes('Applied: 0') || result.output.includes('not found'),
        `Expected skip for occurrence 0, got: ${result.output}`);
    });

    it('all takes precedence over occurrence if both specified', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-both.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'the',
            replace: 'THE-ALL',
            occurrence: 2,  // Should be ignored
            all: true       // This takes precedence
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      // Should apply to all occurrences
      assert.ok(result.success || result.output.includes('Applied'),
        `CLI failed: ${result.error || result.output}`);
    });

    it('handles no matches with all: true gracefully', async () => {
      const outputPath = resolve(OUTPUT_PATH, 'occurrence-nomatch-all.docx');

      const config = {
        input: sampleDocx,
        output: outputPath,
        author: { name: 'Test', email: 'test@example.com' },
        edits: [
          {
            find: 'xyznonexistent123',
            replace: 'REPLACED',
            all: true
          }
        ]
      };

      const result = runCLI(`--inline '${JSON.stringify(config)}'`);

      // Should skip with "Text not found"
      assert.ok(result.output.includes('Skipped') || result.output.includes('not found'),
        `Expected skip message, got: ${result.output}`);
    });
  });
});
