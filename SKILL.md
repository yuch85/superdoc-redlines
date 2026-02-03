---
name: superdoc-redlines
description: CLI tool for AI agents to apply tracked changes and comments to DOCX files
---

# SuperDoc Redlines Skill

## Overview

This tool allows AI agents to programmatically edit Word documents with:
- **Tracked changes** (insertions/deletions visible in Word's review mode)
- **Comments** (annotations attached to text ranges)

## Quick Usage

```bash
# Navigate to the tool directory
cd /path/to/superdoc-redlines

# Run with inline JSON
node superdoc-redline.mjs --inline '{
  "input": "/path/to/contract.docx",
  "output": "/path/to/redlined.docx",
  "author": { "name": "AI Assistant", "email": "ai@example.com" },
  "edits": [
    { "find": "English law", "replace": "Singapore law", "comment": "Changed per Deal Context" },
    { "find": "TUPE 2006", "replace": "", "comment": "DELETE: Not applicable in Singapore" },
    { "find": "Company Name", "comment": "Please verify the correct entity name" }
  ]
}'
```

## Edit Types

| Pattern | Effect |
|---------|--------|
| `{ "find": "X", "replace": "Y" }` | Replace X with Y (tracked change) |
| `{ "find": "X", "replace": "" }` | Delete X (tracked change) |
| `{ "find": "X", "comment": "..." }` | Add comment to X (no change) |
| `{ "find": "X", "replace": "Y", "comment": "..." }` | Replace AND add comment |

## Workflow for Contract Review

1. **Read the document** to understand its content
2. **Identify changes needed** based on deal context
3. **Generate edits JSON** with find/replace/comment entries
4. **Run this CLI** to produce redlined DOCX
5. **Output** can be opened in Microsoft Word for review

## Example: Legal Contract Adaptation

```json
{
  "input": "template_contract.docx",
  "output": "redlined_contract.docx",
  "author": { "name": "Contract Reviewer", "email": "reviewer@firm.com" },
  "edits": [
    {
      "find": "governed by English law",
      "replace": "governed by Singapore law",
      "comment": "Per Deal Context: Singapore governing law required"
    },
    {
      "find": "Transfer of Undertakings (Protection of Employment) Regulations 2006",
      "replace": "",
      "comment": "TUPE does not apply in Singapore"
    },
    {
      "find": "Companies House",
      "replace": "ACRA",
      "comment": "Singapore equivalent of UK Companies House"
    },
    {
      "find": "Data Protection Act 2018",
      "comment": "REVIEW: Consider replacing with PDPA 2012 for Singapore"
    }
  ]
}
```

## Limitations

- **First match only**: Each find/replace applies to the first occurrence
- **Exact match**: Search is exact (case-sensitive)

## Requirements

- Node.js 18+
- npm dependencies installed (`npm install` in tool directory)
