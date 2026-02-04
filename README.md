# superdoc-redlines

A Node.js CLI tool for applying tracked changes and comments to DOCX files using [SuperDoc](https://superdoc.dev) in headless mode.

Designed for use by AI agents (Claude, GPT, etc.) in IDE environments like Cursor, VS Code, or Claude Code.

## Features

- **Structured IR** - Extract stable block IDs from any DOCX document
- **ID-Based Edits** - Deterministic edits that don't depend on fragile text matching
- **Auto-Chunking** - Handles documents of any size with token-aware chunking
- **Multi-Agent Support** - Merge edits from parallel sub-agents with conflict resolution
- **Track Changes** - Word-level diff produces minimal, reviewable changes
- **Comments** - Attach comments to any block for review

## Installation

```bash
npm install
```

## Quick Start

```bash
# 1. Extract document structure (get block IDs)
node superdoc-redline.mjs extract --input contract.docx

# 2. Read document (for LLM analysis)
node superdoc-redline.mjs read --input contract.docx

# 3. Create edits.json referencing block IDs
# 4. Validate edits (optional but recommended)
node superdoc-redline.mjs validate --input contract.docx --edits edits.json

# 5. Apply edits with track changes
node superdoc-redline.mjs apply --input contract.docx --output redlined.docx --edits edits.json
```

## CLI Commands

### `extract`

Extract structured intermediate representation (IR) from a DOCX file.

```bash
node superdoc-redline.mjs extract --input doc.docx --output ir.json
node superdoc-redline.mjs extract -i doc.docx -o ir.json --max-text 100
node superdoc-redline.mjs extract -i doc.docx --no-defined-terms
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input DOCX file (required) |
| `-o, --output <path>` | Output JSON file (default: `<input>-ir.json`) |
| `-f, --format <type>` | Output format: `full\|outline\|blocks` (default: `full`) |
| `--no-defined-terms` | Exclude defined terms extraction |
| `--max-text <length>` | Truncate block text to length |

### `read`

Read document for LLM consumption with automatic chunking.

```bash
node superdoc-redline.mjs read --input doc.docx
node superdoc-redline.mjs read -i doc.docx --chunk 1 --max-tokens 50000
node superdoc-redline.mjs read -i doc.docx --stats-only
node superdoc-redline.mjs read -i doc.docx -f outline
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input DOCX file (required) |
| `-c, --chunk <index>` | Specific chunk index (0-indexed) |
| `--max-tokens <count>` | Max tokens per chunk (default: 100000) |
| `-f, --format <type>` | Output format: `full\|outline\|summary` (default: `full`) |
| `--stats-only` | Only show document statistics |
| `--no-metadata` | Exclude block IDs and positions |

**Output (JSON to stdout):**
```json
{
  "success": true,
  "totalChunks": 1,
  "currentChunk": 0,
  "hasMore": false,
  "nextChunkCommand": null,
  "document": {
    "metadata": { "filename": "doc.docx", "chunkIndex": 0, "totalChunks": 1 },
    "outline": [...],
    "blocks": [...],
    "idMapping": { "uuid-here": "b001" }
  }
}
```

### `validate`

Validate edit instructions against a document.

```bash
node superdoc-redline.mjs validate --input doc.docx --edits edits.json
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input DOCX file (required) |
| `-e, --edits <path>` | Edits JSON file (required) |

**Exit code:** `0` if valid, `1` if issues found.

### `apply`

Apply ID-based edits to a document with track changes.

```bash
node superdoc-redline.mjs apply --input doc.docx --output redlined.docx --edits edits.json
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --author-name "Reviewer"
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --no-track-changes
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --verbose  # Debug position mapping
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --strict   # Fail on truncation warnings
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input DOCX file (required) |
| `-o, --output <path>` | Output DOCX file (required) |
| `-e, --edits <path>` | Edits JSON file (required) |
| `--author-name <name>` | Author name for track changes (default: `"AI Assistant"`) |
| `--author-email <email>` | Author email (default: `"ai@example.com"`) |
| `--no-track-changes` | Disable track changes mode |
| `--no-validate` | Skip validation before applying |
| `--no-sort` | Skip automatic edit sorting |
| `-v, --verbose` | Enable verbose logging for debugging position mapping |
| `--strict` | Treat truncation/corruption warnings as errors |

**Validation:**

The apply command automatically validates edits before applying, including:
- Block ID existence checks
- Required field validation (newText for replace, etc.)
- **newText truncation detection** - Warns if newText appears truncated or corrupted
- **Content corruption detection** - Detects patterns like "4.3S$" that suggest LLM output issues

Use `--strict` to fail the apply if any warnings are detected.

### `merge`

Merge edit files from multiple sub-agents.

```bash
node superdoc-redline.mjs merge edits-a.json edits-b.json -o merged.json
node superdoc-redline.mjs merge *.json -o merged.json --conflict first
node superdoc-redline.mjs merge edits-*.json -o merged.json -v doc.docx
```

**Options:**
| Option | Description |
|--------|-------------|
| `<files...>` | Edit files to merge (required, positional) |
| `-o, --output <path>` | Output merged edits file (required) |
| `-c, --conflict <strategy>` | Conflict strategy: `error\|first\|last\|combine` (default: `error`) |
| `-v, --validate <docx>` | Validate merged edits against document |

**Conflict Strategies:**
- `error` - Fail if any conflicts (safe default)
- `first` - Keep first edit (by file order)
- `last` - Keep last edit (by file order)
- `combine` - Merge comments; use `first` for other operations

### `parse-edits`

Convert markdown edits to JSON format. This enables a more resilient edit format that is easier for LLMs to generate without syntax errors.

```bash
node superdoc-redline.mjs parse-edits -i edits.md -o edits.json
node superdoc-redline.mjs parse-edits -i edits.md -o edits.json --validate doc.docx
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <file>` | Input markdown file (.md) (required) |
| `-o, --output <file>` | Output JSON file (.json) (required) |
| `--validate <docx>` | Validate block IDs against document |

### `to-markdown`

Convert JSON edits to markdown format for human review or editing.

```bash
node superdoc-redline.mjs to-markdown -i edits.json -o edits.md
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <file>` | Input JSON file (.json) (required) |
| `-o, --output <file>` | Output markdown file (.md) (required) |

---

## Markdown Edit Format (Recommended for LLMs)

For large edit sets, the markdown format is more reliable than JSON because:
- No syntax errors from missing commas or quotes
- Partial output is still parseable (truncation recovery)
- Lower cognitive load during generation
- Human-readable for review

### Markdown Format Specification

```markdown
# Edits: [Document Name]

## Metadata
- **Version**: 0.2.0
- **Author Name**: AI Legal Counsel
- **Author Email**: ai@counsel.sg

## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b257 | delete | - | DELETE TULRCA definition |
| b165 | replace | true | Change Business Day to Singapore |
| b500 | comment | - | Review needed |
| b449 | insert | - | Insert new clause |

## Replacement Text

### b165 newText
Business Day: a day other than a Saturday, Sunday or public holiday in Singapore when banks in Singapore are open for business.

### b449 insertText
The Buyer shall offer employment to each Transferring Employee.
```

### Table Columns

| Column | Required | Values | Description |
|--------|----------|--------|-------------|
| Block | Yes | `b###` | Block ID from document IR |
| Op | Yes | `delete`, `replace`, `comment`, `insert` | Operation type |
| Diff | For replace | `true`, `false`, `-` | Word-level diff mode |
| Comment | No | Free text | Rationale for edit |

### Text Sections

- `### b### newText` - Replacement text for `replace` operations
- `### b### insertText` - New content for `insert` operations

### Usage

```bash
# Convert markdown to JSON
node superdoc-redline.mjs parse-edits -i edits.md -o edits.json

# Apply directly from markdown (auto-detects format)
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.md

# Convert existing JSON to markdown for review
node superdoc-redline.mjs to-markdown -i edits.json -o edits.md
```

---

## Track Changes

**Track changes is enabled by default.** All edits appear as native Word revisions when you open the output file in Microsoft Word:

- **Insertions** - Shown as underlined additions
- **Deletions** - Shown as strikethrough removals
- **Changes attributed** to the author you specify (default: "AI Assistant")

### Default Behavior

```bash
# Track changes ON by default
node superdoc-redline.mjs apply -i doc.docx -o redlined.docx -e edits.json
```

### Custom Author Attribution

```bash
node superdoc-redline.mjs apply -i doc.docx -o redlined.docx -e edits.json \
  --author-name "Legal Review Bot" \
  --author-email "review@firm.com"
```

### Disable Track Changes

For direct edits without revision marks:

```bash
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --no-track-changes
```

### Word-Level Diff

By default, `replace` operations use word-level diff to produce **minimal tracked changes**. Only the words that actually changed are marked as insertions/deletions, not the entire block.

To replace the entire block content (useful for complete rewrites):

```json
{
  "blockId": "b025",
  "operation": "replace",
  "newText": "Completely new text here",
  "diff": false
}
```

---

## Edit Format (v0.2.0)

```json
{
  "version": "0.2.0",
  "author": {
    "name": "AI Counsel",
    "email": "ai@firm.com"
  },
  "edits": [
    {
      "blockId": "b001",
      "operation": "replace",
      "newText": "Modified clause text",
      "comment": "Optional comment",
      "diff": true
    },
    {
      "blockId": "b015",
      "operation": "delete",
      "comment": "Removing redundant clause"
    },
    {
      "blockId": "b020",
      "operation": "comment",
      "comment": "Needs legal review"
    },
    {
      "afterBlockId": "b025",
      "operation": "insert",
      "text": "New paragraph content",
      "type": "paragraph"
    }
  ]
}
```

### Edit Operations

| Operation | Required Fields | Optional Fields | Description |
|-----------|-----------------|-----------------|-------------|
| `replace` | `blockId`, `newText` | `comment`, `diff` | Replace block content |
| `delete` | `blockId` | `comment` | Delete block entirely |
| `comment` | `blockId`, `comment` | - | Add comment to block |
| `insert` | `afterBlockId`, `text` | `type`, `level`, `comment` | Insert new block |

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `blockId` | string | Target block (UUID or seqId like `"b001"`) |
| `afterBlockId` | string | Insert position (UUID or seqId) |
| `newText` | string | Replacement text for `replace` operation |
| `text` | string | New block text for `insert` operation |
| `comment` | string | Comment text to attach |
| `diff` | boolean | Use word-level diff for minimal changes (default: `true`) |
| `type` | string | Block type for insert: `paragraph\|heading\|listItem` |
| `level` | number | Heading level for insert (1-6) |

---

## IR Format

The intermediate representation (IR) extracted from a document:

```json
{
  "metadata": {
    "version": "0.2.0",
    "filename": "contract.docx",
    "format": "full",
    "extractedAt": "2026-02-04T10:00:00.000Z"
  },
  "outline": [
    {
      "title": "1. Definitions",
      "level": 1,
      "blockId": "uuid-here",
      "seqId": "b001",
      "children": []
    }
  ],
  "blocks": [
    {
      "id": "uuid-here",
      "seqId": "b001",
      "type": "heading",
      "level": 1,
      "text": "1. Definitions",
      "startPos": 0,
      "endPos": 15
    }
  ],
  "idMapping": {
    "uuid-here": "b001"
  },
  "definedTerms": {
    "Agreement": { "blockId": "b001", "text": "..." }
  }
}
```

### Dual ID System

Each block has two IDs:

| ID Type | Format | Purpose |
|---------|--------|---------|
| **UUID** | `550e8400-e29b-41d4-a716-446655440000` | SuperDoc internal ID, changes on reload |
| **seqId** | `b001`, `b002`, `b003` | Stable sequential ID for LLM reference |

Both formats are accepted in edits. SeqIds are recommended for LLM use.

---

## Chunking

Large documents are automatically split into chunks for LLM context limits.

### How It Works

1. Token estimation: ~4 characters per token
2. Default chunk size: 100,000 tokens
3. Chunks break at heading boundaries when possible
4. Every chunk includes the full document outline for context

### Reading Large Documents

```bash
# Check document size
node superdoc-redline.mjs read --input large.docx --stats-only

# Read first chunk (includes navigation info)
node superdoc-redline.mjs read --input large.docx --chunk 0

# Output includes nextChunkCommand for sequential reading
```

### Chunk Output Structure

```json
{
  "success": true,
  "totalChunks": 3,
  "currentChunk": 0,
  "hasMore": true,
  "nextChunkCommand": "node superdoc-redline.mjs read --input \"large.docx\" --chunk 1",
  "document": {
    "metadata": { "blockRange": { "start": "b001", "end": "b100" } },
    "outline": [...],
    "blocks": [...]
  }
}
```

---

## Multi-Agent Workflow

For parallel review by multiple agents:

```bash
# 1. Extract IR (shared by all agents)
node superdoc-redline.mjs extract -i contract.docx -o contract-ir.json

# 2. Sub-agents produce edit files
# Agent A -> edits-definitions.json
# Agent B -> edits-warranties.json
# Agent C -> edits-govlaw.json

# 3. Merge all edits
node superdoc-redline.mjs merge \
  edits-definitions.json \
  edits-warranties.json \
  edits-govlaw.json \
  -o merged-edits.json \
  -c combine \
  -v contract.docx

# 4. Apply merged edits
node superdoc-redline.mjs apply \
  -i contract.docx \
  -o redlined.docx \
  -e merged-edits.json
```

---

## Breaking Changes from v1.x

### Version Bump

Package version changed from `1.x` to `0.2.0` to signal breaking API changes.

### Removed Features

| v1.x Feature | Status | Migration |
|--------------|--------|-----------|
| Text-based `find`/`replace` edits | **REMOVED** | Use ID-based `blockId` edits |
| `--inline` JSON argument | **REMOVED** | Use `--edits` file path |
| `--config` option | **REMOVED** | Use subcommand + `--edits` |
| Fuzzy text matching for edits | **INTERNAL** | Now used only for IR extraction |
| Clause targeting by text | **REMOVED** | Use `blockId` from extracted IR |

### New CLI Structure

```bash
# OLD (v1.x) - Text-based
node superdoc-redline.mjs --config edits.json
node superdoc-redline.mjs --inline '{"input":"doc.docx","edits":[...]}'

# NEW (v0.2.0) - Subcommands
node superdoc-redline.mjs extract --input doc.docx
node superdoc-redline.mjs read --input doc.docx
node superdoc-redline.mjs validate --input doc.docx --edits edits.json
node superdoc-redline.mjs apply --input doc.docx --output out.docx --edits edits.json
node superdoc-redline.mjs merge edits1.json edits2.json --output merged.json
```

### Migration Path

1. Extract IR to get block IDs: `extract --input doc.docx`
2. Rewrite edits to use `blockId` instead of `find`
3. Use `apply` subcommand instead of root command

---

## Module API

For programmatic use:

### IR Extraction

```javascript
import { extractDocumentIR, createEditorWithIR } from './src/irExtractor.mjs';

// Extract IR from file
const ir = await extractDocumentIR('contract.docx');
console.log(`${ir.blocks.length} blocks`);

// Get IR with editor for block operations
const { editor, ir, cleanup } = await createEditorWithIR('contract.docx');
// ... use editor and ir ...
cleanup();
```

### Block Operations

```javascript
import {
  replaceBlockById,
  deleteBlockById,
  insertAfterBlock,
  addCommentToBlock
} from './src/blockOperations.mjs';

// With word-level diff
await replaceBlockById(editor, 'b001', 'New text');

// Delete a block
await deleteBlockById(editor, 'b005');

// Insert after a block
await insertAfterBlock(editor, 'b010', 'New paragraph');

// Add comment
await addCommentToBlock(editor, 'b015', 'Needs review');
```

### Edit Application

```javascript
import { applyEdits, validateEdits } from './src/editApplicator.mjs';

// Validate first
const validation = await validateEdits('contract.docx', editConfig);
if (!validation.valid) {
  console.error(validation.issues);
}

// Apply edits
const result = await applyEdits('contract.docx', 'redlined.docx', editConfig);
console.log(`Applied: ${result.applied}, Skipped: ${result.skipped.length}`);
```

### Document Reading

```javascript
import { readDocument, getDocumentStats } from './src/documentReader.mjs';

// Get stats
const stats = await getDocumentStats('contract.docx');
console.log(`Blocks: ${stats.blockCount}, Tokens: ${stats.estimatedTokens}`);

// Read with chunking
const result = await readDocument('contract.docx', { chunkIndex: 0 });
```

### Edit Merging

```javascript
import { mergeEditFiles, splitBlocksForAgents } from './src/editMerge.mjs';

// Split work for sub-agents
const ranges = splitBlocksForAgents(ir, 3);

// Merge results
const result = await mergeEditFiles(['a.json', 'b.json'], {
  conflictStrategy: 'combine'
});
```

---

## Testing

```bash
npm test
```

Tests use Node.js built-in test runner (`node:test`):

| File | Tests | Description |
|------|-------|-------------|
| `irExtractor.test.mjs` | IR extraction, block IDs |
| `blockOperations.test.mjs` | Replace, delete, insert, comment |
| `editApplicator.test.mjs` | Validation, application, sorting |
| `documentReader.test.mjs` | Reading, formats, chunking |
| `chunking.test.mjs` | Token estimation, chunking algorithm |
| `editMerge.test.mjs` | Merging, conflicts, validation |
| `multiAgent.test.mjs` | Multi-agent workflows |
| `cli.test.mjs` | CLI command tests |
| `integration.test.mjs` | End-to-end workflow tests |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@harbour-enterprises/superdoc` | Word document manipulation |
| `commander` | CLI argument parsing |
| `jsdom` | DOM environment for headless mode |
| `diff-match-patch` | Word-level diff computation |

---

## License

MIT
