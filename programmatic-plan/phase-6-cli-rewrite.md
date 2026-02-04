# Phase 6: CLI Rewrite

> **Priority**: Medium  
> **Dependencies**: Phases 1-5  
> **Deliverables**: `superdoc-redline.mjs` (complete rewrite)

[← Back to Index](./index.md) | [← Phase 5](./phase-5-multi-agent-merge.md)

---

## Objectives

1. Rewrite the CLI with new subcommand structure
2. Integrate all new modules
3. Provide consistent error handling and output format
4. Support both JSON output (for LLM consumption) and human-readable output

---

## CLI Structure

```bash
# Commands
node superdoc-redline.mjs extract --input doc.docx --output ir.json
node superdoc-redline.mjs read --input doc.docx [--chunk N]
node superdoc-redline.mjs validate --input doc.docx --edits edits.json
node superdoc-redline.mjs apply --input doc.docx --output out.docx --edits edits.json
node superdoc-redline.mjs merge edits1.json edits2.json --output merged.json
```

---

## Module: CLI (`superdoc-redline.mjs`)

### Dependencies

```javascript
#!/usr/bin/env node

import { program } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { extractDocumentIR } from './src/irExtractor.mjs';
import { readDocument, getDocumentStats } from './src/documentReader.mjs';
import { applyEdits, validateEdits } from './src/editApplicator.mjs';
import { mergeEditFiles, validateMergedEdits } from './src/editMerge.mjs';

program
  .name('superdoc-redline')
  .description('Structured document operations for AI agents')
  .version('0.2.0');
```

---

## Command: `extract`

```javascript
program
  .command('extract')
  .description('Extract structured intermediate representation from a DOCX file')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .option('-o, --output <path>', 'Output JSON file (default: <input>-ir.json)')
  .option('-f, --format <type>', 'Output format: full|outline|blocks', 'full')
  .option('--no-defined-terms', 'Exclude defined terms extraction')
  .option('--max-text <length>', 'Truncate block text to length', parseInt)
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
      console.log(`  Output: ${outputPath}`);
      
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });
```

---

## Command: `read`

```javascript
program
  .command('read')
  .description('Read document for LLM consumption (with automatic chunking)')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .option('-c, --chunk <index>', 'Specific chunk index (0-indexed)', parseInt)
  .option('--max-tokens <count>', 'Max tokens per chunk', parseInt, 100000)
  .option('-f, --format <type>', 'Output format: full|outline|summary', 'full')
  .option('--stats-only', 'Only show document statistics')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      
      if (options.statsOnly) {
        const stats = await getDocumentStats(inputPath);
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      
      const result = await readDocument(inputPath, {
        chunkIndex: options.chunk ?? null,
        maxTokens: options.maxTokens,
        format: options.format
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
```

---

## Command: `validate`

```javascript
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
```

---

## Command: `apply`

```javascript
program
  .command('apply')
  .description('Apply ID-based edits to a document')
  .requiredOption('-i, --input <path>', 'Input DOCX file')
  .requiredOption('-o, --output <path>', 'Output DOCX file')
  .requiredOption('-e, --edits <path>', 'Edits JSON file')
  .option('--author-name <name>', 'Author name for track changes', 'AI Assistant')
  .option('--author-email <email>', 'Author email', 'ai@example.com')
  .option('--no-track-changes', 'Disable track changes mode')
  .action(async (options) => {
    try {
      const inputPath = resolve(options.input);
      const outputPath = resolve(options.output);
      const editsPath = resolve(options.edits);
      
      const editsJson = await readFile(editsPath, 'utf-8');
      const editConfig = JSON.parse(editsJson);
      
      console.log(`Loading document: ${inputPath}`);
      console.log(`Applying ${editConfig.edits.length} edit(s)...`);
      
      const result = await applyEdits(inputPath, outputPath, editConfig, {
        trackChanges: options.trackChanges !== false,
        author: {
          name: options.authorName,
          email: options.authorEmail
        }
      });
      
      console.log(`\nResults:`);
      console.log(`  Applied: ${result.applied}`);
      console.log(`  Skipped: ${result.skipped.length}`);
      
      if (result.skipped.length > 0) {
        console.log(`\nSkipped edits:`);
        for (const skip of result.skipped) {
          console.log(`  [${skip.index}] ${skip.blockId} - ${skip.reason}`);
        }
      }
      
      console.log(`\nOutput: ${outputPath}`);
      
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });
```

---

## Command: `merge`

```javascript
program
  .command('merge')
  .description('Merge edit files from multiple sub-agents')
  .requiredOption('-o, --output <path>', 'Output merged edits file')
  .option('-c, --conflict <strategy>', 'Conflict strategy: error|first|last|combine', 'error')
  .option('-v, --validate <docx>', 'Validate merged edits against document')
  .argument('<files...>', 'Edit files to merge')
  .action(async (files, options) => {
    try {
      const editPaths = files.map(f => resolve(f));
      
      console.log(`Merging ${editPaths.length} edit file(s)...`);
      
      const result = await mergeEditFiles(editPaths, {
        conflictStrategy: options.conflict,
        outputPath: resolve(options.output)
      });
      
      if (!result.success) {
        console.error('Merge failed:', result.error);
        console.log('\nConflicts:');
        for (const conflict of result.conflicts) {
          console.log(`  Block ${conflict.blockId}: ${conflict.edits.length} conflicting edits`);
        }
        process.exit(1);
      }
      
      console.log(`\nMerge complete:`);
      console.log(`  Total edits: ${result.stats.totalEdits}`);
      console.log(`  Source files: ${result.stats.sourceFiles}`);
      console.log(`  Conflicts resolved: ${result.stats.conflictsDetected}`);
      console.log(`  Output: ${options.output}`);
      
      // Optional validation
      if (options.validate) {
        const ir = await extractDocumentIR(resolve(options.validate));
        const validation = validateMergedEdits(result.merged, ir);
        
        if (!validation.valid) {
          console.log('\nValidation issues:');
          for (const issue of validation.issues) {
            console.log(`  [${issue.editIndex}] ${issue.type}: ${issue.message}`);
          }
          process.exit(1);
        }
        
        console.log('\nValidation: PASSED');
      }
      
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
```

---

## Test Requirements

### File: `tests/cli.test.mjs`

```javascript
import { execSync } from 'child_process';
import { readFile, writeFile, unlink } from 'fs/promises';

describe('CLI: extract', () => {
  test('extracts IR from document', () => {
    const output = execSync(
      'node superdoc-redline.mjs extract -i fixtures/sample.docx -o /tmp/test-ir.json'
    ).toString();
    expect(output).toContain('Extraction complete');
  });
});

describe('CLI: read', () => {
  test('reads document and outputs JSON', () => {
    const output = execSync(
      'node superdoc-redline.mjs read -i fixtures/sample.docx'
    ).toString();
    const result = JSON.parse(output);
    expect(result.success).toBe(true);
  });
  
  test('shows stats with --stats-only', () => {
    const output = execSync(
      'node superdoc-redline.mjs read -i fixtures/sample.docx --stats-only'
    ).toString();
    const stats = JSON.parse(output);
    expect(stats.blockCount).toBeGreaterThan(0);
  });
});

describe('CLI: validate', () => {
  test('validates valid edits', async () => {
    // Create valid edits file
    await writeFile('/tmp/valid-edits.json', JSON.stringify({
      edits: [{ blockId: 'b001', operation: 'comment', comment: 'test' }]
    }));
    
    const output = execSync(
      'node superdoc-redline.mjs validate -i fixtures/sample.docx -e /tmp/valid-edits.json'
    ).toString();
    const result = JSON.parse(output);
    expect(result.valid).toBeDefined();
  });
});

describe('CLI: apply', () => {
  test('applies edits to document', async () => {
    await writeFile('/tmp/apply-edits.json', JSON.stringify({
      edits: [{ blockId: 'b001', operation: 'comment', comment: 'test' }]
    }));
    
    const output = execSync(
      'node superdoc-redline.mjs apply -i fixtures/sample.docx -o /tmp/applied.docx -e /tmp/apply-edits.json'
    ).toString();
    expect(output).toContain('Applied:');
  });
});

describe('CLI: merge', () => {
  test('merges multiple edit files', async () => {
    await writeFile('/tmp/edits-1.json', JSON.stringify({
      edits: [{ blockId: 'b001', operation: 'comment', comment: 'A' }]
    }));
    await writeFile('/tmp/edits-2.json', JSON.stringify({
      edits: [{ blockId: 'b002', operation: 'comment', comment: 'B' }]
    }));
    
    const output = execSync(
      'node superdoc-redline.mjs merge /tmp/edits-1.json /tmp/edits-2.json -o /tmp/merged.json'
    ).toString();
    expect(output).toContain('Merge complete');
  });
});
```

---

## Success Criteria

1. **All commands work**
   - extract, read, validate, apply, merge all function correctly

2. **Consistent error handling**
   - All errors output to stderr
   - Exit codes are correct (0 for success, 1 for failure)

3. **JSON output is parseable**
   - LLMs can consume read/validate output directly

4. **Human-readable feedback**
   - Progress messages for long operations
   - Clear summaries of results

---

## Exit Conditions

- [ ] `superdoc-redline.mjs` completely rewritten
- [ ] All five commands implemented and working
- [ ] All Phase 6 tests pass
- [ ] CLI help text is accurate and helpful

---

[← Back to Index](./index.md) | [← Phase 5](./phase-5-multi-agent-merge.md) | [Next: Phase 7 →](./phase-7-docs-integration.md)
