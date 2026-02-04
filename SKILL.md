---
name: superdoc-redlines
description: CLI tool for AI agents to apply tracked changes and comments to DOCX files using ID-based editing
---

# SuperDoc Redlines Skill

## Overview

This tool allows AI agents to programmatically edit Word documents with:
- **Tracked changes** (insertions/deletions visible in Word's review mode)
- **Comments** (annotations attached to document blocks)

Uses **ID-based editing** for deterministic, position-independent edits.

## Quick Workflow

### Step 1: Extract Document Structure

```bash
node superdoc-redline.mjs extract --input contract.docx --output contract-ir.json
```

This produces `contract-ir.json` with block IDs like `b001`, `b002`, etc.

### Step 2: Read Document (for analysis)

```bash
# Read entire document (or first chunk if large)
node superdoc-redline.mjs read --input contract.docx

# Read specific chunk for large documents
node superdoc-redline.mjs read --input contract.docx --chunk 1

# Get document stats only
node superdoc-redline.mjs read --input contract.docx --stats-only
```

Output is JSON to stdout - parse it to understand document structure.

### Step 3: Create Edits File

Create `edits.json` referencing block IDs from the IR:

```json
{
  "version": "0.2.0",
  "edits": [
    {
      "blockId": "b025",
      "operation": "replace",
      "newText": "This Agreement shall be governed by Singapore law.",
      "comment": "Changed from English law per deal requirements"
    },
    {
      "blockId": "b089",
      "operation": "delete",
      "comment": "Removed TUPE clause - not applicable in Singapore"
    },
    {
      "blockId": "b042",
      "operation": "comment",
      "comment": "Please verify the correct entity name"
    },
    {
      "afterBlockId": "b010",
      "operation": "insert",
      "text": "\"Material Adverse Change\" means any change that...",
      "type": "paragraph"
    }
  ]
}
```

### Step 4: Validate (Optional)

```bash
node superdoc-redline.mjs validate --input contract.docx --edits edits.json
```

Exit code `0` = valid, `1` = issues found.

### Step 5: Apply Edits

```bash
node superdoc-redline.mjs apply \
  --input contract.docx \
  --output redlined.docx \
  --edits edits.json \
  --strict
```

Result: `redlined.docx` with tracked changes visible in Microsoft Word.

**Apply options:**
- `--strict` - Treat truncation/corruption warnings as errors (recommended)
- `--verbose` - Enable detailed logging for debugging
- `--no-track-changes` - Disable track changes mode
- `--no-validate` - Skip validation before applying

## Edit Operations

| Operation | Required Fields | Description |
|-----------|-----------------|-------------|
| `replace` | `blockId`, `newText` | Replace block content (uses word-level diff) |
| `delete` | `blockId` | Delete block entirely |
| `comment` | `blockId`, `comment` | Add comment to block (no text change) |
| `insert` | `afterBlockId`, `text` | Insert new block after specified block |

### Optional Fields

| Field | Applies To | Description |
|-------|-----------|-------------|
| `comment` | All | Attach comment explaining the change |
| `diff` | `replace` | Use word-level diff (default: `true`) |
| `type` | `insert` | Block type: `paragraph`, `heading`, `listItem` |
| `level` | `insert` | Heading level (1-6) if type is `heading` |

## ID Formats

Both formats are accepted:

| Format | Example | Usage |
|--------|---------|-------|
| **seqId** | `b001`, `b025`, `b100` | Recommended - stable, human-readable |
| **UUID** | `550e8400-e29b-41d4-...` | Internal SuperDoc format |

SeqIds are derived from document order and are consistent across extractions of the same document.

## Large Documents (Chunking)

For documents with many blocks:

```bash
# Check if chunking needed
node superdoc-redline.mjs read --input large.docx --stats-only
# Returns: { blockCount, estimatedTokens, recommendedChunks }

# Read chunks sequentially
node superdoc-redline.mjs read --input large.docx --chunk 0
# Returns: { hasMore: true, nextChunkCommand: "..." }

node superdoc-redline.mjs read --input large.docx --chunk 1
# Continue until hasMore: false
```

Each chunk includes the full document outline for context.

## Multi-Agent Workflow

For parallel review:

```bash
# 1. Extract once
node superdoc-redline.mjs extract -i contract.docx -o ir.json

# 2. Each sub-agent produces edits (no conflicts if different blockIds)
# edits-agent-a.json, edits-agent-b.json

# 3. Merge
node superdoc-redline.mjs merge \
  edits-agent-a.json edits-agent-b.json \
  -o merged.json \
  -c combine

# 4. Apply merged edits
node superdoc-redline.mjs apply -i contract.docx -o redlined.docx -e merged.json
```

Conflict strategies:
- `error` - Fail if same block edited by multiple agents
- `first` - Keep first agent's edit
- `last` - Keep last agent's edit
- `combine` - Merge comments, use first for other operations

## Example: Legal Contract Review

```json
{
  "version": "0.2.0",
  "edits": [
    {
      "blockId": "b015",
      "operation": "replace",
      "newText": "This Agreement shall be governed by and construed in accordance with the laws of Singapore.",
      "comment": "Governing law: Changed from English law to Singapore law"
    },
    {
      "blockId": "b078",
      "operation": "delete",
      "comment": "TUPE Regulations: Not applicable in Singapore jurisdiction"
    },
    {
      "blockId": "b045",
      "operation": "replace",
      "newText": "The Seller shall register the transfer with ACRA within 14 days.",
      "comment": "Replaced Companies House with Singapore equivalent (ACRA)"
    },
    {
      "blockId": "b102",
      "operation": "comment",
      "comment": "REVIEW: Consider adding force majeure provisions"
    }
  ]
}
```

## Track Changes

**Track changes is ON by default.** Output files open in Microsoft Word with all edits visible as revisions.

| What You See | Meaning |
|--------------|---------|
| Underlined text | Insertion |
| ~~Strikethrough text~~ | Deletion |
| Author name in margin | Who made the change |

### Customize Author

```bash
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json \
  --author-name "AI Counsel" \
  --author-email "ai@firm.com"
```

### Disable Track Changes

For direct edits (no revision marks):

```bash
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.json --no-track-changes
```

### Word-Level Diff

`replace` operations use word-level diff by default - only changed words are marked, not the entire block. Set `"diff": false` in an edit to replace the whole block.

## Markdown Edit Format (Recommended)

For large edit sets, use markdown format instead of JSON - it's more resilient to generation errors:

```markdown
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b257 | delete | - | DELETE TULRCA |
| b165 | replace | true | Change to Singapore |

### b165 newText
Business Day: a day in Singapore when banks are open.
```

**Advantages over JSON:**
- No syntax errors from missing commas
- Partial output still parseable
- Human-readable for review

```bash
# Convert markdown to JSON
node superdoc-redline.mjs parse-edits -i edits.md -o edits.json

# Apply directly from markdown (auto-detects)
node superdoc-redline.mjs apply -i doc.docx -o out.docx -e edits.md
```

## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| `extract -i doc.docx -o ir.json` | Get block IDs |
| `read -i doc.docx` | Read for LLM (JSON to stdout) |
| `read -i doc.docx --stats-only` | Check document size |
| `read -i doc.docx --chunk N` | Read specific chunk |
| `validate -i doc.docx -e edits.json` | Validate edits |
| `apply -i doc.docx -o out.docx -e edits.json` | Apply with track changes |
| `apply ... --strict` | Fail on truncation warnings |
| `apply ... --verbose` | Debug position mapping |
| `apply -i doc.docx -o out.docx -e edits.md` | Apply from markdown |
| `merge a.json b.json -o merged.json -c error` | Merge agent edits (strict) |
| `parse-edits -i edits.md -o edits.json` | Convert markdown to JSON |
| `to-markdown -i edits.json -o edits.md` | Convert JSON to markdown |

## Requirements

- Node.js 18+
- npm dependencies installed (`npm install` in tool directory)
