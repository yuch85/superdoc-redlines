/**
 * CLI Tests - Phase 6
 *
 * Integration tests for the CLI commands: extract, read, validate, apply, merge.
 * These tests run the actual CLI and verify the outputs.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../../superdoc-redline.mjs');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const OUTPUT_DIR = resolve(__dirname, 'output');
const SAMPLE_DOCX = resolve(FIXTURES_DIR, 'sample.docx');

/**
 * Run a CLI command and return the output.
 * @param {string} args - CLI arguments
 * @param {boolean} expectError - Whether to expect an error exit code
 * @returns {string} - stdout + stderr combined
 */
function runCLI(args, expectError = false) {
  try {
    const output = execSync(`node "${CLI_PATH}" ${args}`, {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output;
  } catch (error) {
    if (expectError) {
      // Return both stdout and stderr for error cases
      return (error.stdout || '') + (error.stderr || '');
    }
    throw error;
  }
}

// Ensure output directory exists
before(async () => {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }
});

// Cleanup temp files after tests
after(async () => {
  const tempFiles = [
    '/tmp/test-ir.json',
    '/tmp/valid-edits.json',
    '/tmp/apply-edits.json',
    '/tmp/edits-1.json',
    '/tmp/edits-2.json',
    '/tmp/merged.json',
    '/tmp/applied.docx',
    '/tmp/conflict-1.json',
    '/tmp/conflict-2.json'
  ];
  for (const file of tempFiles) {
    try {
      await unlink(file);
    } catch (e) {
      // Ignore if file doesn't exist
    }
  }
});

// ============================================================================
// Help and Version
// ============================================================================

describe('CLI: help and version', () => {
  it('shows help with --help', () => {
    const output = runCLI('--help');
    assert.ok(output.includes('superdoc-redline'));
    assert.ok(output.includes('extract'));
    assert.ok(output.includes('read'));
    assert.ok(output.includes('validate'));
    assert.ok(output.includes('apply'));
    assert.ok(output.includes('merge'));
  });

  it('shows version with --version', () => {
    const output = runCLI('--version');
    assert.equal(output.trim(), '0.2.0');
  });

  it('shows extract help', () => {
    const output = runCLI('extract --help');
    assert.ok(output.includes('Extract structured intermediate representation'));
    assert.ok(output.includes('--input'));
    assert.ok(output.includes('--output'));
  });

  it('shows read help', () => {
    const output = runCLI('read --help');
    assert.ok(output.includes('Read document for LLM consumption'));
    assert.ok(output.includes('--chunk'));
    assert.ok(output.includes('--max-tokens'));
  });

  it('shows apply help', () => {
    const output = runCLI('apply --help');
    assert.ok(output.includes('Apply ID-based edits'));
    assert.ok(output.includes('--edits'));
    assert.ok(output.includes('--author-name'));
  });

  it('shows merge help', () => {
    const output = runCLI('merge --help');
    assert.ok(output.includes('Merge edit files'));
    assert.ok(output.includes('--conflict'));
    assert.ok(output.includes('--validate'));
  });
});

// ============================================================================
// Command: extract
// ============================================================================

describe('CLI: extract', () => {
  it('extracts IR from document', () => {
    const output = runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    assert.ok(output.includes('Extracting IR from'));
    assert.ok(output.includes('Extraction complete'));
    assert.ok(output.includes('Blocks:'));
  });

  it('creates valid JSON output', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);

    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    assert.ok(ir.metadata);
    assert.equal(ir.metadata.version, '0.2.0');
    assert.ok(ir.blocks);
    assert.ok(Array.isArray(ir.blocks));
    assert.ok(ir.blocks.length > 0);
  });

  it('blocks have required fields', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);

    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    const block = ir.blocks[0];
    assert.ok(block.id);
    assert.ok(block.seqId);
    assert.ok(block.type);
    assert.ok(block.text !== undefined);
    assert.ok(block.startPos !== undefined);
    assert.ok(block.endPos !== undefined);
  });

  it('includes outline by default', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);

    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    assert.ok(ir.outline !== undefined);
  });

  it('supports --max-text option', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json --max-text 5`);

    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    // Check that text is truncated for blocks with longer text
    const block = ir.blocks[0];
    // Either text is short enough or it ends with '...'
    assert.ok(block.text.length <= 8 || block.text.endsWith('...'));
  });
});

// ============================================================================
// Command: read
// ============================================================================

describe('CLI: read', () => {
  it('reads document and outputs JSON', () => {
    const output = runCLI(`read -i "${SAMPLE_DOCX}"`);
    const result = JSON.parse(output);

    assert.equal(result.success, true);
    assert.ok(result.document);
  });

  it('includes chunk metadata', () => {
    const output = runCLI(`read -i "${SAMPLE_DOCX}"`);
    const result = JSON.parse(output);

    assert.ok(result.totalChunks !== undefined);
    assert.ok(result.currentChunk !== undefined);
    assert.ok(result.hasMore !== undefined);
  });

  it('shows stats with --stats-only', () => {
    const output = runCLI(`read -i "${SAMPLE_DOCX}" --stats-only`);
    const stats = JSON.parse(output);

    assert.ok(stats.blockCount > 0);
    assert.ok(stats.estimatedTokens > 0);
    assert.ok(stats.recommendedChunks >= 1);
  });

  it('supports outline format', () => {
    const output = runCLI(`read -i "${SAMPLE_DOCX}" -f outline`);
    const result = JSON.parse(output);

    assert.equal(result.success, true);
    assert.ok(result.document.outline !== undefined);
    // Outline format should not include full blocks array
    assert.equal(result.document.blocks, undefined);
  });

  it('supports summary format', () => {
    const output = runCLI(`read -i "${SAMPLE_DOCX}" -f summary`);
    const result = JSON.parse(output);

    assert.equal(result.success, true);
    assert.ok(result.document.headings !== undefined);
    assert.ok(result.document.blockCount !== undefined);
  });

  it('supports --no-metadata flag', () => {
    const output = runCLI(`read -i "${SAMPLE_DOCX}" --no-metadata`);
    const result = JSON.parse(output);

    assert.equal(result.success, true);
    // Blocks should not have id/seqId when metadata is stripped
    if (result.document.blocks && result.document.blocks.length > 0) {
      assert.equal(result.document.blocks[0].id, undefined);
      assert.equal(result.document.blocks[0].seqId, undefined);
    }
  });
});

// ============================================================================
// Command: validate
// ============================================================================

describe('CLI: validate', () => {
  it('validates valid edits', async () => {
    // First extract to get valid block IDs
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    // Create valid edits file
    const validEdits = {
      edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'test' }]
    };
    await writeFile('/tmp/valid-edits.json', JSON.stringify(validEdits));

    const output = runCLI(`validate -i "${SAMPLE_DOCX}" -e /tmp/valid-edits.json`);
    const result = JSON.parse(output);

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
  });

  it('detects invalid block IDs', async () => {
    const invalidEdits = {
      edits: [{ blockId: 'b999', operation: 'comment', comment: 'test' }]
    };
    await writeFile('/tmp/valid-edits.json', JSON.stringify(invalidEdits));

    const output = runCLI(`validate -i "${SAMPLE_DOCX}" -e /tmp/valid-edits.json`, true);
    const result = JSON.parse(output);

    assert.equal(result.valid, false);
    assert.ok(result.issues.length > 0);
    assert.equal(result.issues[0].type, 'missing_block');
  });

  it('detects missing required fields', async () => {
    // First get a valid block ID
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    const invalidEdits = {
      edits: [
        { blockId: ir.blocks[0].seqId, operation: 'replace' }  // Missing newText
      ]
    };
    await writeFile('/tmp/valid-edits.json', JSON.stringify(invalidEdits));

    const output = runCLI(`validate -i "${SAMPLE_DOCX}" -e /tmp/valid-edits.json`, true);
    const result = JSON.parse(output);

    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, 'missing_field');
  });

  it('provides summary in output', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    const validEdits = {
      edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'test' }]
    };
    await writeFile('/tmp/valid-edits.json', JSON.stringify(validEdits));

    const output = runCLI(`validate -i "${SAMPLE_DOCX}" -e /tmp/valid-edits.json`);
    const result = JSON.parse(output);

    assert.ok(result.summary);
    assert.equal(result.summary.totalEdits, 1);
    assert.equal(result.summary.validEdits, 1);
  });
});

// ============================================================================
// Command: apply
// ============================================================================

describe('CLI: apply', () => {
  it('applies comment edit to document', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    const edits = {
      edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Test comment' }]
    };
    await writeFile('/tmp/apply-edits.json', JSON.stringify(edits));

    const output = runCLI(`apply -i "${SAMPLE_DOCX}" -o /tmp/applied.docx -e /tmp/apply-edits.json`);

    assert.ok(output.includes('Loading document'));
    assert.ok(output.includes('Applied: 1'));
    assert.ok(output.includes('Skipped: 0'));
    assert.ok(existsSync('/tmp/applied.docx'));
  });

  it('supports custom author', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    const edits = {
      edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'Authored comment' }]
    };
    await writeFile('/tmp/apply-edits.json', JSON.stringify(edits));

    const output = runCLI(
      `apply -i "${SAMPLE_DOCX}" -o /tmp/applied.docx -e /tmp/apply-edits.json ` +
      `--author-name "Test Author" --author-email "test@example.com"`
    );

    assert.ok(output.includes('Applied: 1'));
  });

  it('reports skipped edits with invalid IDs', async () => {
    const edits = {
      edits: [{ blockId: 'b999', operation: 'comment', comment: 'Invalid' }]
    };
    await writeFile('/tmp/apply-edits.json', JSON.stringify(edits));

    const output = runCLI(
      `apply -i "${SAMPLE_DOCX}" -o /tmp/applied.docx -e /tmp/apply-edits.json`,
      true
    );

    assert.ok(output.includes('Skipped: 1'));
    assert.ok(output.includes('b999'));
  });

  it('applies multiple edits', async () => {
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    // Only use edits if we have enough blocks
    const numEdits = Math.min(3, ir.blocks.length);
    const edits = {
      edits: ir.blocks.slice(0, numEdits).map((b, i) => ({
        blockId: b.seqId,
        operation: 'comment',
        comment: `Comment ${i + 1}`
      }))
    };
    await writeFile('/tmp/apply-edits.json', JSON.stringify(edits));

    const output = runCLI(`apply -i "${SAMPLE_DOCX}" -o /tmp/applied.docx -e /tmp/apply-edits.json`);

    assert.ok(output.includes(`Applied: ${numEdits}`));
  });
});

// ============================================================================
// Command: merge
// ============================================================================

describe('CLI: merge', () => {
  it('merges non-conflicting edit files', async () => {
    const edits1 = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'A' }] };
    const edits2 = { edits: [{ blockId: 'b002', operation: 'comment', comment: 'B' }] };

    await writeFile('/tmp/edits-1.json', JSON.stringify(edits1));
    await writeFile('/tmp/edits-2.json', JSON.stringify(edits2));

    const output = runCLI('merge /tmp/edits-1.json /tmp/edits-2.json -o /tmp/merged.json');

    assert.ok(output.includes('Merge complete'));
    assert.ok(output.includes('Total edits: 2'));
    assert.ok(output.includes('Source files: 2'));

    const mergedJson = await readFile('/tmp/merged.json', 'utf-8');
    const merged = JSON.parse(mergedJson);
    assert.equal(merged.edits.length, 2);
  });

  it('detects conflicts with error strategy', async () => {
    const edits1 = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'A' }] };
    const edits2 = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'B' }] };

    await writeFile('/tmp/conflict-1.json', JSON.stringify(edits1));
    await writeFile('/tmp/conflict-2.json', JSON.stringify(edits2));

    const output = runCLI(
      'merge /tmp/conflict-1.json /tmp/conflict-2.json -o /tmp/merged.json -c error',
      true
    );

    assert.ok(output.includes('Merge failed'));
    assert.ok(output.toLowerCase().includes('conflict'));
    assert.ok(output.includes('b001'));
  });

  it('resolves conflicts with first strategy', async () => {
    const edits1 = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'First' }] };
    const edits2 = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'Second' }] };

    await writeFile('/tmp/conflict-1.json', JSON.stringify(edits1));
    await writeFile('/tmp/conflict-2.json', JSON.stringify(edits2));

    const output = runCLI('merge /tmp/conflict-1.json /tmp/conflict-2.json -o /tmp/merged.json -c first');

    assert.ok(output.includes('Merge complete'));
    assert.ok(output.includes('Conflicts resolved: 1'));

    const mergedJson = await readFile('/tmp/merged.json', 'utf-8');
    const merged = JSON.parse(mergedJson);
    assert.equal(merged.edits[0].newText, 'First');
  });

  it('resolves conflicts with last strategy', async () => {
    const edits1 = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'First' }] };
    const edits2 = { edits: [{ blockId: 'b001', operation: 'replace', newText: 'Last' }] };

    await writeFile('/tmp/conflict-1.json', JSON.stringify(edits1));
    await writeFile('/tmp/conflict-2.json', JSON.stringify(edits2));

    const output = runCLI('merge /tmp/conflict-1.json /tmp/conflict-2.json -o /tmp/merged.json -c last');

    assert.ok(output.includes('Merge complete'));

    const mergedJson = await readFile('/tmp/merged.json', 'utf-8');
    const merged = JSON.parse(mergedJson);
    assert.equal(merged.edits[0].newText, 'Last');
  });

  it('combines comments with combine strategy', async () => {
    const edits1 = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'Comment A' }] };
    const edits2 = { edits: [{ blockId: 'b001', operation: 'comment', comment: 'Comment B' }] };

    await writeFile('/tmp/conflict-1.json', JSON.stringify(edits1));
    await writeFile('/tmp/conflict-2.json', JSON.stringify(edits2));

    const output = runCLI('merge /tmp/conflict-1.json /tmp/conflict-2.json -o /tmp/merged.json -c combine');

    assert.ok(output.includes('Merge complete'));

    const mergedJson = await readFile('/tmp/merged.json', 'utf-8');
    const merged = JSON.parse(mergedJson);
    assert.ok(merged.edits[0].comment.includes('Comment A'));
    assert.ok(merged.edits[0].comment.includes('Comment B'));
  });

  it('validates merged edits against document', async () => {
    // First extract to get valid block IDs
    runCLI(`extract -i "${SAMPLE_DOCX}" -o /tmp/test-ir.json`);
    const irJson = await readFile('/tmp/test-ir.json', 'utf-8');
    const ir = JSON.parse(irJson);

    const edits1 = { edits: [{ blockId: ir.blocks[0].seqId, operation: 'comment', comment: 'A' }] };
    // Use same block if only one block exists
    const secondBlockId = ir.blocks[1]?.seqId || ir.blocks[0].seqId;
    const edits2 = { edits: [{ blockId: secondBlockId, operation: 'comment', comment: 'B' }] };

    await writeFile('/tmp/edits-1.json', JSON.stringify(edits1));
    await writeFile('/tmp/edits-2.json', JSON.stringify(edits2));

    // Use combine strategy if both edits target same block
    const strategy = secondBlockId === ir.blocks[0].seqId ? '-c combine' : '';
    const output = runCLI(
      `merge /tmp/edits-1.json /tmp/edits-2.json -o /tmp/merged.json ${strategy} -v "${SAMPLE_DOCX}"`
    );

    assert.ok(output.includes('Merge complete'));
    assert.ok(output.includes('Validating against'));
    assert.ok(output.includes('Validation: PASSED'));
  });

  it('reports validation failures', async () => {
    const edits1 = { edits: [{ blockId: 'b999', operation: 'comment', comment: 'Invalid' }] };

    await writeFile('/tmp/edits-1.json', JSON.stringify(edits1));

    const output = runCLI(
      `merge /tmp/edits-1.json -o /tmp/merged.json -v "${SAMPLE_DOCX}"`,
      true
    );

    assert.ok(output.includes('Validation issues'));
    assert.ok(output.includes('missing_block'));
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('CLI: error handling', () => {
  it('extract fails gracefully with missing file', () => {
    const output = runCLI('extract -i /nonexistent.docx -o /tmp/out.json', true);
    assert.ok(output.toLowerCase().includes('error'));
  });

  it('read fails gracefully with missing file', () => {
    const output = runCLI('read -i /nonexistent.docx', true);
    assert.ok(output.toLowerCase().includes('error'));
  });

  it('validate fails gracefully with missing edits file', () => {
    const output = runCLI(`validate -i "${SAMPLE_DOCX}" -e /nonexistent.json`, true);
    assert.ok(output.toLowerCase().includes('error'));
  });

  it('apply fails gracefully with invalid JSON', async () => {
    await writeFile('/tmp/invalid.json', 'not valid json');
    const output = runCLI(`apply -i "${SAMPLE_DOCX}" -o /tmp/out.docx -e /tmp/invalid.json`, true);
    assert.ok(output.toLowerCase().includes('error'));
    await unlink('/tmp/invalid.json');
  });

  it('merge fails gracefully with missing files', () => {
    const output = runCLI('merge /nonexistent1.json /nonexistent2.json -o /tmp/out.json', true);
    assert.ok(output.toLowerCase().match(/error|failed/));
  });
});
