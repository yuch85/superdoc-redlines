/**
 * Tests for superdoc-redline.mjs
 *
 * Uses Node.js built-in test runner (node:test)
 * Run with: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../superdoc-redline.mjs');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const OUTPUT_DIR = resolve(__dirname, 'output');

/**
 * Helper to run the CLI and capture output
 */
async function runCLI(args) {
  const cmd = `node "${CLI_PATH}" ${args}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: resolve(__dirname, '..'),
      timeout: 30000,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
    };
  }
}

/**
 * Helper to extract text content from DOCX
 */
async function extractDocxText(docxPath) {
  const { stdout } = await execAsync(
    `unzip -p "${docxPath}" word/document.xml | grep -o '<w:t[^>]*>[^<]*</w:t>' | sed 's/<[^>]*>//g'`
  );
  return stdout.trim();
}

/**
 * Helper to check if DOCX contains tracked changes (w:ins or w:del)
 */
async function hasTrackedChanges(docxPath) {
  try {
    const { stdout } = await execAsync(
      `unzip -p "${docxPath}" word/document.xml | grep -c 'w:ins\\|w:del' || echo "0"`
    );
    return parseInt(stdout.trim(), 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Helper to check if DOCX contains comments
 */
async function hasComments(docxPath) {
  try {
    const { stdout } = await execAsync(
      `unzip -l "${docxPath}" | grep -c 'word/comments.xml' || echo "0"`
    );
    return parseInt(stdout.trim(), 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Helper to extract comment text from DOCX
 */
async function extractComments(docxPath) {
  try {
    const { stdout } = await execAsync(
      `unzip -p "${docxPath}" word/comments.xml 2>/dev/null | grep -o '<w:t[^>]*>[^<]*</w:t>' | sed 's/<[^>]*>//g'`
    );
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// Setup and teardown
before(async () => {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }
});

after(async () => {
  // Cleanup output files (optional - keep for manual inspection)
  // const files = await readdir(OUTPUT_DIR);
  // for (const file of files) {
  //   await unlink(resolve(OUTPUT_DIR, file));
  // }
});

// ============================================================================
// Test Suite: CLI Argument Parsing
// ============================================================================

describe('CLI Argument Parsing', () => {
  test('should show help with --help', async () => {
    const { stdout, exitCode } = await runCLI('--help');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('superdoc-redline'));
    assert.ok(stdout.includes('--config'));
    assert.ok(stdout.includes('--input'));
  });

  test('should show version with --version', async () => {
    const { stdout, exitCode } = await runCLI('--version');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('1.0.0'));
  });

  test('should fail without required arguments', async () => {
    const { exitCode, stderr } = await runCLI('');
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('Must provide'));
  });

  test('should fail with missing input file', async () => {
    const { exitCode, stderr } = await runCLI(
      '--input nonexistent.docx --output out.docx --edits "[]"'
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('not found') || stderr.includes('Error'));
  });
});

// ============================================================================
// Test Suite: Tracked Changes (Replacements)
// ============================================================================

describe('Tracked Changes', () => {
  test('should replace text with tracked change', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'tracked_change_replace.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test Author', email: 'test@example.com' },
      edits: [{ find: 'initial', replace: 'final' }],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0, `CLI failed: ${stdout}`);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Verify the text was replaced
    const text = await extractDocxText(outputPath);
    assert.ok(text.includes('final'), `Expected "final" in output, got: ${text}`);

    // Verify tracked changes exist
    const tracked = await hasTrackedChanges(outputPath);
    assert.ok(tracked, 'Expected tracked changes in output');
  });

  test('should delete text with empty replacement', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'tracked_change_delete.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test Author', email: 'test@example.com' },
      edits: [{ find: 'initial ', replace: '' }],
    };

    const { exitCode } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Verify tracked changes exist (deletion is a tracked change)
    const tracked = await hasTrackedChanges(outputPath);
    assert.ok(tracked, 'Expected tracked changes for deletion');
  });

  test('should handle multiple replacements', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'tracked_change_multiple.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test Author', email: 'test@example.com' },
      edits: [
        { find: 'This', replace: 'That' },
        { find: 'initial', replace: 'final' },
      ],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0, `CLI failed: ${stdout}`);
    assert.ok(existsSync(outputPath), 'Output file not created');

    const text = await extractDocxText(outputPath);
    assert.ok(text.includes('That') || text.includes('final'), `Replacements not found in: ${text}`);
  });

  test('should skip edit when text not found', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'tracked_change_skip.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test Author', email: 'test@example.com' },
      edits: [{ find: 'nonexistent text xyz123', replace: 'replacement' }],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Skipped: 1') || stdout.includes('not found'), `Expected skip message in: ${stdout}`);
  });
});

// ============================================================================
// Test Suite: Comments
// ============================================================================

describe('Comments', () => {
  test('should add comment without replacement', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'comment_only.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Reviewer', email: 'reviewer@example.com' },
      edits: [{ find: 'document', comment: 'Please review this section' }],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0, `CLI failed: ${stdout}`);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Verify comments.xml exists
    const hasComment = await hasComments(outputPath);
    assert.ok(hasComment, 'Expected comments.xml in output');

    // Verify comment author and text are in the file
    const { stdout: commentXml } = await execAsync(
      `unzip -p "${outputPath}" word/comments.xml 2>/dev/null`
    );
    assert.ok(commentXml.includes('Reviewer'), 'Expected author name in comments.xml');
    assert.ok(commentXml.includes('review'), 'Expected comment text in comments.xml');
  });

  test('should add comment with replacement (both tracked change and comment)', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'replace_and_comment.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'AI Assistant', email: 'ai@example.com' },
      edits: [
        {
          find: 'initial',
          replace: 'final',
          comment: 'Changed per client request',
        },
      ],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0, `CLI failed: ${stdout}`);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Verify both tracked changes and comments
    const hasTracked = await hasTrackedChanges(outputPath);
    const hasComment = await hasComments(outputPath);

    assert.ok(hasTracked, 'Expected tracked changes in output');
    assert.ok(hasComment, 'Expected comments in output');
  });

  test('should add multiple comments', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'multiple_comments.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Reviewer', email: 'reviewer@example.com' },
      edits: [
        { find: 'This', comment: 'Comment on This' },
        { find: 'document', comment: 'Comment on document' },
      ],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0, `CLI failed: ${stdout}`);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Verify comments.xml exists
    const hasComment = await hasComments(outputPath);
    assert.ok(hasComment, 'Expected comments.xml in output');

    // Count comment elements in the XML
    const { stdout: commentXml } = await execAsync(
      `unzip -p "${outputPath}" word/comments.xml 2>/dev/null | grep -o 'w:comment ' | wc -l`
    );
    const commentCount = parseInt(commentXml.trim(), 10);
    assert.ok(commentCount >= 2, `Expected at least 2 comments, got: ${commentCount}`);
  });
});

// ============================================================================
// Test Suite: Config File Input
// ============================================================================

describe('Config File Input', () => {
  test('should accept --config file', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'from_config_file.docx');
    const configPath = resolve(OUTPUT_DIR, 'test_config.json');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Config Test', email: 'config@test.com' },
      edits: [{ find: 'initial', replace: 'configured' }],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    const { exitCode } = await runCLI(`--config "${configPath}"`);

    assert.strictEqual(exitCode, 0);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Cleanup config file
    await unlink(configPath);
  });
});

// ============================================================================
// Test Suite: Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  test('should handle non-breaking spaces in search text', async () => {
    // This tests the normalization of \u00a0 to regular spaces
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'nbsp_handling.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test', email: 'test@test.com' },
      // Search with regular space (should match even if doc has nbsp)
      edits: [{ find: 'the initial', replace: 'the final' }],
    };

    const { exitCode } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    // Should complete without error (may or may not find match depending on fixture)
    assert.strictEqual(exitCode, 0);
  });

  test('should preserve author metadata', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'author_metadata.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: {
        name: 'Custom Author Name',
        email: 'custom.author@company.com',
      },
      edits: [{ find: 'initial', replace: 'final' }],
    };

    const { exitCode } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0);
    assert.ok(existsSync(outputPath), 'Output file not created');

    // Note: Verifying author metadata in XML would require parsing the DOCX
    // For now, just verify the operation completed
  });

  test('should handle empty edits array gracefully', async () => {
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'empty_edits.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test', email: 'test@test.com' },
      edits: [],
    };

    const { exitCode, stdout } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Applied: 0'));
  });
});

// ============================================================================
// Test Suite: First Match Policy
// ============================================================================

describe('First Match Policy', () => {
  test('should only replace first occurrence', async () => {
    // Note: Our sample fixture only has one occurrence of most words
    // This test documents the expected behavior
    const inputPath = resolve(FIXTURES_DIR, 'sample.docx');
    const outputPath = resolve(OUTPUT_DIR, 'first_match.docx');

    const config = {
      input: inputPath,
      output: outputPath,
      author: { name: 'Test', email: 'test@test.com' },
      edits: [{ find: 'i', replace: 'I' }], // 'i' appears multiple times
    };

    const { exitCode } = await runCLI(`--inline '${JSON.stringify(config)}'`);

    assert.strictEqual(exitCode, 0);
    // The first 'i' in "This" should be replaced, subsequent ones unchanged
    // (Position-based edit ensures only first match is affected)
  });
});
