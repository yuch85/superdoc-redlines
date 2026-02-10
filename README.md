# superdoc-redlines

A Node.js CLI tool for applying tracked changes and comments to DOCX files using [SuperDoc](https://superdoc.dev) in headless mode.

Designed for use by AI agents (Claude, GPT, etc.) in IDE environments like Cursor, VS Code, or Claude Code.

<p align="center">
  <a href="https://youtu.be/EgG6wqaYTcs">
    <img src="./tests_and_others/superdoc-demo-small-1.gif" alt="Demo video" />
  </a>
</p>

<p align="center"><em><small>Sped-up 30s demo of multi-agentic contract review of a 100+ page contract using Claude Code, this library and the <a href="./skills/CONTRACT-REVIEW-AGENTIC-SKILL.md">CONTRACT-REVIEW-AGENTIC-SKILL.md</a> workflow — <a href="https://youtu.be/EgG6wqaYTcs">click to see the full-length video</a>.</small></em></p>

> **For AI Agents:** See [SKILL.md](./SKILL.md) for the concise task-oriented guide with decision flows, constraints, and expected outputs.

## Example Skills

- [Contract Review Skill](./skills/CONTRACT-REVIEW-SKILL.md)
- [Contract Review Agentic Skill](./skills/CONTRACT-REVIEW-AGENTIC-SKILL.md)

## Features

- **Structured IR** - Extract stable block IDs from any DOCX document
- **ID-Based Edits** - Deterministic edits that don't depend on fragile text matching
- **Auto-Chunking** - Handles documents of any size with token-aware chunking
- **Multi-Agent Support** - Merge edits from parallel sub-agents with conflict resolution
- **Track Changes** - Word-level diff produces minimal, reviewable changes
- **Comments** - Attach comments to any block for review
- **Text-Span Annotations** - Anchor comments and highlights to specific text within blocks (sub-block granularity)

## Installation

```bash
git clone https://github.com/yuch85/superdoc-redlines
cd superdoc-redlines
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

---

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
| `--skip-invalid` | Skip invalid edits instead of failing |
| `-q, --quiet-warnings` | Suppress content reduction warnings |
| `--allow-reduction` | Allow intentional content reduction without warnings (for jurisdiction conversions) |

**Content reduction:** A replace edit where `newText` is significantly shorter than the original block. This can be intentional (simplification) or a sign of truncation/corruption. Do **not** allow reduction for normal proofreading or minor edits where text length should stay similar.

**Validation:**

The apply command automatically validates edits before applying, including:
- Block ID existence checks
- Required field validation (newText for replace, etc.)
- **newText truncation detection** - Warns if newText appears truncated or corrupted
- **Content corruption detection** - Detects patterns that suggest LLM output issues

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
| `-n, --normalize` | Normalize field names from common variants (type→operation, etc.) |
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

### `find-block`

Find blocks by text content. Useful for locating block IDs when creating edits.

```bash
node superdoc-redline.mjs find-block --input contract.docx --text "VAT"
node superdoc-redline.mjs find-block --input contract-ir.json --regex "VAT|HMRC"
node superdoc-redline.mjs find-block -i contract.docx -t "Business Day" -c 100
node superdoc-redline.mjs find-block -i contract.docx -t "VAT" --limit 100
node superdoc-redline.mjs find-block -i contract.docx -t "VAT" --limit all
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input DOCX file or IR JSON file (required) |
| `-t, --text <text>` | Text to search for (case-insensitive) |
| `-r, --regex <pattern>` | Regex pattern to search for |
| `-c, --context <chars>` | Context characters to show around match (default: 50) |
| `-l, --limit <n>` | Maximum results (default: 20, use "all" for unlimited) |

**Note:** The default limit of 20 results may miss edits for high-frequency terms. For comprehensive discovery, use `--limit all`.

**Example output:**
```
Found 3 block(s):

[b051] (paragraph)
  ID: c9742b66-c68b-4a5b-92aa-b742b141425e
  Preview: ...Capital allowances923.Stamp duty and SDLT924.VAT925.Inheritance tax936.[Distraint by HMRC]93Schedu...

[b129] (heading)
  ID: 603fbb12-bb15-428c-985a-336afff6b4a5
  Preview: 4.VAT92
```

### `recompress`

Recompress a DOCX file to reduce file size. SuperDoc writes uncompressed DOCX files (~6x larger than normal).

```bash
node superdoc-redline.mjs recompress --input bloated.docx
node superdoc-redline.mjs recompress -i bloated.docx -o clean.docx
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input DOCX file (required) |
| `-o, --output <path>` | Output DOCX file (default: overwrites input) |

**Example output:**
```
Recompressing: bloated.docx
  Original size: 2560.0 KB
  Compressed size: 384.0 KB
  Reduction: 85%
  Output: clean.docx
```

**Note:** Requires `archiver` and `unzipper` packages. Install with: `npm install archiver unzipper`

---

## Edit Format (v0.3.0)

> **AI Agents:** See [SKILL.md](./SKILL.md) for JSON Schema, common mistakes, and critical constraints.

### Block-Level Operations (v0.2.0+)

```json
{
  "version": "0.3.0",
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

### Text-Span Operations (v0.3.0)

These operations anchor to specific text within a block using `findText` for sub-block granularity:

```json
{
  "version": "0.3.0",
  "author": { "name": "AI Counsel", "email": "ai@firm.com" },
  "edits": [
    {
      "blockId": "b020",
      "operation": "comment",
      "findText": "Material Adverse Change",
      "comment": "Definition is too broad"
    },
    {
      "blockId": "b035",
      "operation": "insertAfterText",
      "findText": "reasonable endeavours",
      "insertText": " (acting in good faith)"
    },
    {
      "blockId": "b042",
      "operation": "highlight",
      "findText": "unlimited liability",
      "color": "#FF6B6B",
      "comment": "Flag for partner review"
    },
    {
      "blockId": "b050",
      "operation": "commentRange",
      "findText": "governing law shall be England",
      "comment": "Should this be Singapore?"
    },
    {
      "blockId": "b060",
      "operation": "commentHighlight",
      "findText": "entire agreement",
      "comment": "Check against side letter",
      "color": "#FFEB3B"
    }
  ]
}
```

### Edit Operations

| Operation | Required Fields | Optional Fields | Description |
|-----------|-----------------|-----------------|-------------|
| `replace` | `blockId`, `newText` | `comment`, `diff` | Replace block content |
| `delete` | `blockId` | `comment` | Delete block entirely |
| `comment` | `blockId`, `comment` | `findText` | Add comment to block (or to specific text if `findText` provided) |
| `insert` | `afterBlockId`, `text` | `type`, `level`, `comment` | Insert new block |
| `insertAfterText` | `blockId`, `findText`, `insertText` | `comment` | Insert text immediately after matched text within a block |
| `highlight` | `blockId`, `findText` | `color`, `comment` | Highlight specific text within a block |
| `commentRange` | `blockId`, `findText`, `comment` | - | Add comment anchored to specific text span |
| `commentHighlight` | `blockId`, `findText`, `comment` | `color` | Highlight text and attach a comment (atomic) |

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
| `findText` | string | Exact text to match within a block (for text-span operations) |
| `insertText` | string | Text to insert after matched text (`insertAfterText` only) |
| `color` | string | Highlight color as hex string (default: `"#FFEB3B"`) |

### Text-Span Behavior

- **`findText` matching** uses exact string matching within the block's text content
- **`comment` with `findText`** gracefully falls back to a full-block comment if the text is not found
- **`commentRange`** also falls back to full-block comment on match failure
- **Sort order**: When multiple text-span operations target the same block, they are applied rightmost-first to prevent position corruption
- **Conflict detection**: Text-span operations use composite keys (`blockId::operation::findText`) so multiple annotations on different text spans within the same block do not conflict

---

## Markdown Edit Format (Recommended for LLMs)

For large edit sets, the markdown format is more reliable than JSON because:
- No syntax errors from missing commas or quotes
- Partial output is still parseable (truncation recovery)
- Lower cognitive load during generation
- Human-readable for review

### Markdown Format Specification

The markdown format supports two table layouts: a 4-column format for basic operations and a 6-column extended format when text-span operations are used.

**4-Column Format (block-level operations only):**

```markdown
# Edits: [Document Name]

## Metadata
- **Version**: 0.3.0
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

**6-Column Format (when using text-span operations):**

```markdown
## Edits Table

| Block | Op | FindText | Color | Diff | Comment |
|-------|-----|----------|-------|------|---------|
| b165 | replace | - | - | true | Change Business Day |
| b020 | comment | Material Adverse Change | - | - | Definition too broad |
| b035 | insertAfterText | reasonable endeavours | - | - | (acting in good faith) |
| b042 | highlight | unlimited liability | #FF6B6B | - | Flag for review |
| b050 | commentRange | governing law | - | - | Should be Singapore? |
| b060 | commentHighlight | entire agreement | #FFEB3B | - | Check side letter |
```

The format is auto-detected: if any edit uses `findText`, `color`, or a text-span operation, the 6-column format is used. For `insertAfterText`, the Comment column contains the text to insert.

### Table Columns

**4-Column Format:**

| Column | Required | Values | Description |
|--------|----------|--------|-------------|
| Block | Yes | `b###` | Block ID from document IR |
| Op | Yes | `delete`, `replace`, `comment`, `insert` | Operation type |
| Diff | For replace | `true`, `false`, `-` | Word-level diff mode |
| Comment | No | Free text | Rationale for edit |

**6-Column Format (extends 4-column):**

| Column | Required | Values | Description |
|--------|----------|--------|-------------|
| Block | Yes | `b###` | Block ID from document IR |
| Op | Yes | All 8 operation types | Operation type |
| FindText | For text-span ops | Exact text string, `-` | Text to match within block |
| Color | For highlight ops | Hex color string, `-` | Highlight color |
| Diff | For replace | `true`, `false`, `-` | Word-level diff mode |
| Comment | No | Free text | Rationale (or insertText for `insertAfterText`) |

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

# 3. Merge all edits (use --normalize if sub-agents use inconsistent field names)
node superdoc-redline.mjs merge \
  edits-definitions.json \
  edits-warranties.json \
  edits-govlaw.json \
  -o merged-edits.json \
  -c error \
  --normalize \
  -v contract.docx

# 4. Apply merged edits (use --skip-invalid to continue past bad edits)
node superdoc-redline.mjs apply \
  -i contract.docx \
  -o redlined.docx \
  -e merged-edits.json \
  --skip-invalid
```

### Block Range Assignment Best Practices

> **⚠️ Important:** Don't assign sequential block ranges (b001-b300, b301-b600, etc.) without considering clause type distribution.

Legal documents have clause types scattered throughout - governing law clauses may appear in definitions, main provisions, and schedules. Sequential assignment will miss edits when agents don't have all blocks for their assigned clause types.

**Recommended approach:**
1. During discovery, map clause types to actual block locations
2. Assign agents by clause type grouping, not sequential ranges
3. Include overlap buffer zones for ambiguous boundaries

See [CONTRACT-REVIEW-AGENTIC-SKILL.md](./skills/CONTRACT-REVIEW-AGENTIC-SKILL.md) for detailed guidance on multi-agent orchestration.

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
  addCommentToBlock,
  findTextPositionInBlock,
  insertTextAfterMatch,
  highlightTextInBlock,
  addCommentToTextInBlock
} from './src/blockOperations.mjs';

// With word-level diff
await replaceBlockById(editor, 'b001', 'New text');

// Delete a block
await deleteBlockById(editor, 'b005');

// Insert after a block
await insertAfterBlock(editor, 'b010', 'New paragraph');

// Add comment to whole block
await addCommentToBlock(editor, 'b015', 'Needs review');
```

#### Text-Span Operations (v0.3.0)

```javascript
// Find text position within a block
const pos = findTextPositionInBlock(editor, 'b020', 'Material Adverse Change');
// => { found: true, from: 142, to: 166 }

// Insert text after a match
await insertTextAfterMatch(editor, 'b035', 'reasonable endeavours', ' (acting in good faith)');

// Highlight specific text (default yellow)
await highlightTextInBlock(editor, 'b042', 'unlimited liability');

// Highlight with custom color
await highlightTextInBlock(editor, 'b042', 'unlimited liability', '#FF6B6B');

// Add comment anchored to specific text
await addCommentToTextInBlock(editor, 'b050', 'governing law', 'Should this be Singapore?');
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
import { mergeEditFiles, normalizeEdit, splitBlocksForAgents } from './src/editMerge.mjs';

// Split work for sub-agents
const ranges = splitBlocksForAgents(ir, 3);

// Merge results (with field name normalization)
const result = await mergeEditFiles(['a.json', 'b.json'], {
  conflictStrategy: 'error',
  normalize: true  // Fixes type→operation, replacement→newText, etc.
});

// Normalize a single edit manually
const normalized = normalizeEdit({
  blockId: 'b001',
  type: 'replace',         // Will become 'operation'
  replacement: 'text',     // Will become 'newText'
  search: 'some text',     // Will become 'findText'
  highlightColor: '#FF0'   // Will become 'color'
});
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

## Known Issues and Workarounds

### Output File Size (Uncompressed DOCX)

**Issue:** Output DOCX files are ~6x larger than expected (~2.5MB instead of ~400KB).

**Cause:** The JSZip library uses `ZIP_STORED` (no compression) by default.

**Solution:** Use the `recompress` command:
```bash
node superdoc-redline.mjs recompress --input bloated.docx --output clean.docx
```

Alternatively, see [CONTRACT-REVIEW-SKILL.md](./skills/CONTRACT-REVIEW-SKILL.md) "Step 5: Recompress Output File" for a Python script.

### recommendedChunks Calculation

**Fixed in v0.2.0:** The `--stats-only` output now respects `--max-tokens` and provides multiple recommendations:

```bash
node superdoc-redline.mjs read --stats-only --input doc.docx --max-tokens 10000
```

Output includes:
- `recommendedChunks` - Based on your specified `--max-tokens` (or default 100k)
- `recommendedChunksByLimit` - Recommendations for common limits (10k, 25k, 40k, 100k)
- `maxTokensUsed` - The limit used for the primary calculation

### Track Changes IR Extraction

**Issue:** When extracting IR from an amended document (with track changes), both deleted and inserted text appear concatenated.

**Cause:** Track changes preserves deleted text in the document structure; IR extraction captures all text content.

**This is expected behavior.** To get only the final text, open the DOCX in Word, accept all changes, save, then re-extract.

### TOC Block Editing Failures

**Issue:** Editing Table of Contents blocks may fail with errors like:
```
[CommandService] Dispatch failed: Invalid content for node paragraph: <link(run(link(textStyle(trackDelete("X.")))))
```

**Cause:** TOC blocks have deeply nested link structures that ProseMirror cannot handle when track changes are applied.

**Solution:** Skip TOC blocks in edit files. The apply command now detects and warns about TOC-like blocks during validation. See [CONTRACT-REVIEW-SKILL.md](./skills/CONTRACT-REVIEW-SKILL.md) "TOC Block Limitations" for details.

---

## Testing

```bash
npm test
```

Tests use Node.js built-in test runner (`node:test`):

| File | Tests | Description |
|------|-------|-------------|
| `irExtractor.test.mjs` | IR extraction, block IDs |
| `blockOperations.test.mjs` | Replace, delete, insert, comment, text-span operations |
| `editApplicator.test.mjs` | Validation, application, sorting, text-span ops |
| `documentReader.test.mjs` | Reading, formats, chunking |
| `chunking.test.mjs` | Token estimation, chunking algorithm |
| `editMerge.test.mjs` | Merging, conflicts, validation, composite conflict keys |
| `markdownEditsParser.test.mjs` | Markdown ↔ JSON conversion, 4/6-column formats |
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

## Shout-outs

This tool wouldn't exist without [**SuperDoc**](https://superdoc.dev) by [Harbour](https://harbour.enterprises) — a truly exceptional document editing library that makes programmatic Word document manipulation not just possible, but elegant. Their headless mode is a game-changer for AI-driven workflows.

We also tip our hats to the giants SuperDoc stands on:

- [**Marijn Haverbeke**](https://marijnhaverbeke.nl/) and the community behind [**ProseMirror**](https://prosemirror.net/) — the foundation that makes rich text editing on the web possible
- [**Tiptap**](https://tiptap.dev/) and the many amazing editors of the web — from which we all draw inspiration
- These wonderful projects that SuperDoc uses: [Yjs](https://yjs.dev/), [FontAwesome](https://fontawesome.com/), [JSZip](https://stuk.github.io/jszip/), and [Vite](https://vitejs.dev/)
- [**diff-match-patch**](https://github.com/google/diff-match-patch) by Google — enabling our word-level diff magic

---

## License

Apache License 2.0. This library depends on Superdoc, which is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
