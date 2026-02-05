---
name: superdoc-redlines
description: CLI tool for AI agents to apply tracked changes and comments to DOCX files using ID-based editing
version: 0.2.0
commands: [extract, read, validate, apply, merge, parse-edits, to-markdown]
reference_doc: README.md
---

# SuperDoc Redlines Skill

> **Full Reference:** See [README.md](./README.md) for complete API documentation, module API, and migration notes.

## Overview

This tool allows AI agents to programmatically edit Word documents with:
- **Tracked changes** (insertions/deletions visible in Word's review mode)
- **Comments** (annotations attached to document blocks)

Uses **ID-based editing** for deterministic, position-independent edits.

---

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
- `--skip-invalid` - Skip invalid edits instead of failing (apply valid ones)
- `-q, --quiet-warnings` - Suppress content reduction warnings
- `--verbose` - Enable detailed logging for debugging
- `--no-track-changes` - Disable track changes mode
- `--no-validate` - Skip validation before applying

---

## Decision Flow

Use this flowchart to determine the correct approach:

### 1. How big is the document?

```
Run: node superdoc-redline.mjs read --input doc.docx --stats-only

If estimatedTokens < 100000:
  → Read whole document: node superdoc-redline.mjs read --input doc.docx

If estimatedTokens >= 100000:
  → Use chunked reading:
    1. node superdoc-redline.mjs read --input doc.docx --chunk 0
    2. Check hasMore in response
    3. Continue with --chunk 1, --chunk 2, etc. until hasMore: false
```

### 2. What operation do I need?

```
Want to CHANGE existing text?
  → Use "operation": "replace" with "blockId" and "newText"

Want to REMOVE a clause entirely?
  → Use "operation": "delete" with "blockId"

Want to ADD a reviewer note WITHOUT changing text?
  → Use "operation": "comment" with "blockId" and "comment"

Want to INSERT new content after a block?
  → Use "operation": "insert" with "afterBlockId" and "text"
```

### 3. Should I use word-level diff?

```
Making small changes (currency symbols, names, dates)?
  → Use "diff": true (default) - produces minimal tracked changes

Rewriting entire clause with new structure?
  → Use "diff": false - replaces whole block content
```

### 4. How to handle errors?

```
"Block ID not found":
  → Verify blockId exists in extracted IR
  → Check for typos (b001 vs B001 - case sensitive)
  → Re-extract IR if document changed

"Truncation warning":
  → Re-generate edit with COMPLETE newText
  → Use markdown format instead of JSON for large edits

"Validation failed":
  → Check required fields are present
  → Verify operation type is valid
  → Ensure newText is not empty for replace operations
```

---

## Critical Constraints

<critical_constraints>

**MUST follow these rules:**

1. **Block IDs are case-sensitive** — Use `b001`, NOT `B001` or `B-001`

2. **Field names are exact** — Use these EXACT names:
   - `blockId` (not `id`, `block_id`, or `blockID`)
   - `operation` (not `type`, `op`, or `action`)
   - `newText` (not `replaceText`, `text`, or `new_text`)
   - `afterBlockId` (not `insertAfter` or `after_block_id`)

3. **`newText` MUST be COMPLETE** — Include the ENTIRE replacement text, not just the changed portion. Truncated text will produce incorrect diffs.

4. **One operation per block** — Don't create multiple edits for the same blockId

5. **Version is required** — Always include `"version": "0.2.0"` in the root object

6. **Insert uses `afterBlockId`** — NOT `blockId`. The new block is inserted AFTER the specified block.

</critical_constraints>

---

## Common Mistakes

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| `"type": "replace"` | `"operation": "replace"` | Use `operation` not `type` |
| `"replaceText": "..."` | `"newText": "..."` | Use `newText` for replacements |
| `"id": "b001"` | `"blockId": "b001"` | Use `blockId` not `id` |
| `"searchText": "old"` | *(not used)* | Tool is block-based, not search-based |
| `"blockId": "B001"` | `"blockId": "b001"` | IDs are lowercase |
| `"text": "..."` for replace | `"newText": "..."` | `text` is only for insert operations |
| Truncated `newText` | Full replacement text | Always include complete text |
| Missing comma in JSON | Use markdown format | Markdown is more resilient |

---

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

---

## Edit Schema (JSON Schema)

Use this schema to validate your edits before applying:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "edits"],
  "properties": {
    "version": {
      "type": "string",
      "const": "0.2.0"
    },
    "author": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "email": { "type": "string", "format": "email" }
      }
    },
    "edits": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "title": "Replace Operation",
            "required": ["blockId", "operation", "newText"],
            "properties": {
              "blockId": { "type": "string", "pattern": "^b\\d+$" },
              "operation": { "const": "replace" },
              "newText": { "type": "string", "minLength": 1 },
              "comment": { "type": "string" },
              "diff": { "type": "boolean", "default": true }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "title": "Delete Operation",
            "required": ["blockId", "operation"],
            "properties": {
              "blockId": { "type": "string", "pattern": "^b\\d+$" },
              "operation": { "const": "delete" },
              "comment": { "type": "string" }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "title": "Comment Operation",
            "required": ["blockId", "operation", "comment"],
            "properties": {
              "blockId": { "type": "string", "pattern": "^b\\d+$" },
              "operation": { "const": "comment" },
              "comment": { "type": "string", "minLength": 1 }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "title": "Insert Operation",
            "required": ["afterBlockId", "operation", "text"],
            "properties": {
              "afterBlockId": { "type": "string", "pattern": "^b\\d+$" },
              "operation": { "const": "insert" },
              "text": { "type": "string", "minLength": 1 },
              "type": { "enum": ["paragraph", "heading", "listItem"], "default": "paragraph" },
              "level": { "type": "integer", "minimum": 1, "maximum": 6 },
              "comment": { "type": "string" }
            },
            "additionalProperties": false
          }
        ]
      }
    }
  }
}
```

---

## Expected Outputs

### Successful Apply

```json
{
  "success": true,
  "applied": 5,
  "skipped": [],
  "warnings": [],
  "outputFile": "redlined.docx"
}
```

### Apply with Warnings

```json
{
  "success": true,
  "applied": 4,
  "skipped": [
    { "blockId": "b999", "reason": "Block ID not found" }
  ],
  "warnings": [
    { "blockId": "b050", "warning": "Possible truncation detected in newText" }
  ],
  "outputFile": "redlined.docx"
}
```

### Validation Error

```json
{
  "success": false,
  "valid": false,
  "issues": [
    { "blockId": "b999", "error": "Block ID not found in document" },
    { "index": 2, "error": "Missing required field: newText" }
  ]
}
```

### Read Document Output

```json
{
  "success": true,
  "totalChunks": 1,
  "currentChunk": 0,
  "hasMore": false,
  "nextChunkCommand": null,
  "document": {
    "metadata": { "filename": "doc.docx", "blockRange": { "start": "b001", "end": "b150" } },
    "outline": [
      { "title": "1. Definitions", "level": 1, "seqId": "b001" }
    ],
    "blocks": [
      { "seqId": "b001", "type": "heading", "level": 1, "text": "1. Definitions" },
      { "seqId": "b002", "type": "paragraph", "text": "\"Agreement\" means..." }
    ]
  }
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Validation error, edit failed, or `--strict` warning |

---

## ID Formats

Both formats are accepted:

| Format | Example | Usage |
|--------|---------|-------|
| **seqId** | `b001`, `b025`, `b100` | Recommended - stable, human-readable |
| **UUID** | `550e8400-e29b-41d4-...` | Internal SuperDoc format |

SeqIds are derived from document order and are consistent across extractions of the same document.

---

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

---

## Multi-Agent Workflow

For parallel review:

```bash
# 1. Extract once
node superdoc-redline.mjs extract -i contract.docx -o ir.json

# 2. Each sub-agent produces edits (no conflicts if different blockIds)
# edits-agent-a.json, edits-agent-b.json

# 3. Merge (use --normalize if sub-agents use inconsistent field names)
node superdoc-redline.mjs merge \
  edits-agent-a.json edits-agent-b.json \
  -o merged.json \
  -c error \
  --normalize

# 4. Apply merged edits (use --skip-invalid to continue past bad edits)
node superdoc-redline.mjs apply -i contract.docx -o redlined.docx -e merged.json --skip-invalid
```

**Merge options:**
- `-c error` - Fail if same block edited by multiple agents (safest, recommended)
- `-c first` - Keep first agent's edit
- `-c last` - Keep last agent's edit
- `-c combine` - Merge comments, use first for other operations
- `-n, --normalize` - Fix inconsistent field names (type→operation, etc.)

> **⚠️ Block Range Assignment Warning**
>
> Don't assign sequential block ranges (b001-b300, b301-b600, etc.) without considering clause type distribution. Legal documents have clause types scattered throughout - governing law may appear in definitions, main body, and schedules.
>
> **Best practice:** During discovery, map clause types to actual block locations, then assign agents by clause type grouping. See `skills/CONTRACT-REVIEW-AGENTIC-SKILL.md` for detailed guidance.

---

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

---

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

---

## Markdown Edit Format (Recommended)

For large edit sets, use markdown format instead of JSON - it's more resilient to generation errors:

```markdown
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b257 | delete | - | DELETE TULRCA |
| b165 | replace | true | Change to Singapore |

## Replacement Text

### b165 newText
Business Day: a day in Singapore when banks are open.
```

**Important:** Do NOT add `## sections` (like `## Notes` or `## Summary`) after `## Replacement Text` — the parser stops at these headings, so any trailing sections will be excluded from the last edit's newText.

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

---

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
| `apply ... --skip-invalid` | Skip bad edits, apply good ones |
| `apply ... -q` | Suppress content reduction warnings |
| `apply ... --verbose` | Debug position mapping |
| `apply -i doc.docx -o out.docx -e edits.md` | Apply from markdown |
| `merge a.json b.json -o merged.json -c error` | Merge agent edits (strict) |
| `merge ... --normalize` | Fix inconsistent field names |
| `parse-edits -i edits.md -o edits.json` | Convert markdown to JSON |
| `to-markdown -i edits.json -o edits.md` | Convert JSON to markdown |

---

## Requirements

- Node.js 18+
- npm dependencies installed (`npm install` in tool directory)
