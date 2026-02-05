---
name: Contract Review Skill
description: Systematic methodology for AI agents to review and amend contracts using superdoc-redlines
---

# Contract Review Skill

## Overview

This skill provides a **systematic methodology** for reviewing and amending legal contracts using the superdoc-redlines library.

**Core Principles:**
1. **Chunked, systematic review** - Process documents in manageable chunks (10K tokens max)
2. **Two-pass workflow** - Discovery first, then Amendment
3. **Exact amendments** - Draft precise replacement text during analysis, not vague directions

> **⚠️ Examples Are Illustrative Only**
> 
> This document uses **UK → Singapore jurisdiction conversion** as a running example. The specific examples (VAT→GST, block IDs like b165, etc.) are purely illustrative.
> 
> This methodology applies to **any contract review task**: jurisdiction conversions, commercial term updates, party changes, regulatory compliance, etc.

---

## Quick Reference: The Four Rules

```
┌─────────────────────────────────────────────────────────────────┐
│  RULE 1: TWO-PASS WORKFLOW                                      │
│  Pass 1: Discovery - read all chunks, build Context Document    │
│  Pass 2: Amendment - draft exact amendments with full context   │
├─────────────────────────────────────────────────────────────────┤
│  RULE 2: CHUNK AT 10K TOKENS                                    │
│  Always use: --max-tokens 10000                                 │
├─────────────────────────────────────────────────────────────────┤
│  RULE 3: BUILD CONTEXT DOCUMENT                                 │
│  Track ALL defined terms and where they appear across chunks.   │
├─────────────────────────────────────────────────────────────────┤
│  RULE 4: DRAFT EXACT TEXT                                       │
│  Every amendment must include complete replacement text.        │
│  "Change X to Y" is NEVER acceptable.                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ CRITICAL: Exact Amendments Required

**When analyzing each chunk, you MUST draft the EXACT replacement text immediately.**

| ❌ WRONG (Vague) | ✅ CORRECT (Exact) |
|------------------|-------------------|
| "Change London to Singapore" | `newText: "...banks in Singapore are open for business."` |
| "Update to Singapore Companies Act" | `newText: "Companies Act: the Companies Act 1967 of Singapore."` |

**Why:** No interpretation gap, immediate validation, faster execution, catches errors early.

---

## Setup Phase

### Step 1: Get Document Statistics

```bash
cd /path/to/superdoc-redlines
node superdoc-redline.mjs read --input contract.docx --stats-only
```

Output tells you block count, token estimate, and recommended chunks.

### Step 2: Extract Structure

```bash
node superdoc-redline.mjs extract --input contract.docx --output contract-ir.json
```

This creates the authoritative block ID mapping.

---

## PASS 1: Discovery (Read-Only)

**Goal:** Read ALL chunks and build a **Context Document**. NO amendments yet.

### Step 1.1: Read Each Chunk

```bash
node superdoc-redline.mjs read --input contract.docx --chunk 0 --max-tokens 10000
node superdoc-redline.mjs read --input contract.docx --chunk 1 --max-tokens 10000
# ... continue until hasMore: false
```

### Step 1.2: Build Context Document

As you read each chunk, populate:

```markdown
# Context Document: [Contract Name]

## Document Statistics
- Total chunks: X | Total blocks: Y | Date: [date]

## 1. Defined Terms to Change
| Original | New | Def Block | Usage Blocks | Amended? |
|----------|-----|-----------|--------------|----------|
| [term] | [new] | b### | b###, b###... | [ ] |

## 2. Compound Defined Terms
| Compound Term | Contains | Def Block | New Term |
|---------------|----------|-----------|----------|
| [term] | [base] | b### | [new] |

## 3. Definitions to DELETE (no equivalent)
| Term | Def Block | Delete Edit Created? |
|------|-----------|---------------------|
| [term] | b### | [ ] |

## 4. Provisions to Delete + Insertions Needed
| Block | Provision | Delete? | Insert Equivalent? |
|-------|-----------|---------|-------------------|
| b### | [desc] | Yes | Yes/No |

## 5. Cross-References Map
| Reference | Target | Block IDs |
|-----------|--------|-----------|
| "clause 1" | Definitions | b###, b### |

## 6. Chunks Summary
| Chunk | Block Range | Key Sections |
|-------|-------------|--------------|
| 0 | b001-b150 | Parties, Recitals |
```

### Step 1.3: Definitions Audit (CRITICAL)

**⚠️ MANDATORY.** Scan the Definitions section and:
1. List EVERY defined term
2. Flag terms for DELETE (no equivalent in target jurisdiction)
3. Identify compound terms (e.g., "VAT Records" contains "VAT")
4. Record ALL block IDs

### Discovery Checklist

Before Pass 2:
- [ ] All chunks read
- [ ] All defined terms logged with ALL usage locations
- [ ] Definitions audit complete
- [ ] Provisions to delete/replace identified
- [ ] Cross-references mapped

---

## PASS 2: Amendment (With Context)

**Goal:** Read each chunk AGAIN, drafting exact amendments with cross-chunk awareness.

### Step 2.1: Analyze Each Chunk

For each chunk, create amendments with exact text:

```markdown
## Chunk [N] Analysis (b[XXX]-b[YYY])

### Amendment 1 (Block b165)
**Category:** Jurisdiction
**Diff Mode:** true
**Current:** "...banks in London are open for business."
**Exact New Text:** "...banks in Singapore are open for business."
**Rationale:** UK→Singapore jurisdiction change

### Amendment 2 (Block b257)
**Action:** DELETE
**Current:** "TULRCA: the Trade Union and Labour Relations..."
**Rationale:** No Singapore equivalent
```

### Step 2.2: Mark Progress in Context Document

After each chunk, update the Context Document to track which terms/blocks have been amended.

---

## Creating the Edits File

### Markdown Format (Recommended for >30 edits)

```markdown
## Edits Table
| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b257 | delete | - | DELETE: no equivalent |
| b165 | replace | true | Jurisdiction change |

## Replacement Text

### b165 newText
Business Day: a day other than a Saturday, Sunday or public holiday in Singapore when banks in Singapore are open for business.
```

### JSON Format (for smaller edit sets)

```json
{
  "version": "0.2.0",
  "author": { "name": "AI Legal Counsel" },
  "edits": [
    {
      "blockId": "b165",
      "operation": "replace",
      "newText": "Business Day: a day other than...",
      "comment": "Jurisdiction change",
      "diff": true
    }
  ]
}
```

### Diff Mode Selection

| Use `diff: true` | Use `diff: false` |
|------------------|-------------------|
| Changing few words | Rewriting entire clause |
| Term replacements | Structural changes |
| Surgical edits | >50% text change |

---

## Execution Workflow

### Step 1: Pre-Apply Verification

Before applying, verify against Context Document:
- [ ] All DELETE items have edits
- [ ] All compound terms changed
- [ ] No residual terms in newText that should have been changed

### Step 2: Validate

```bash
node superdoc-redline.mjs validate --input contract.docx --edits edits.json
```

### Step 3: Apply

```bash
node superdoc-redline.mjs apply \
  --input contract.docx \
  --output contract-amended.docx \
  --edits edits.json \
  --author-name "AI Legal Counsel"
```

### Step 4: Post-Apply Verification

Search output for residual terms that should have been changed. If found, create additional edits and re-apply.

### Step 5: Recompress Output File

**⚠️ The SuperDoc library writes DOCX files without compression**, resulting in files ~6x larger than expected. Recompress to reduce file size:

```python
python3 << 'EOF'
import zipfile, os

input_file = "amended.docx"
temp_dir = "/tmp/docx-recompress"

# Extract
os.makedirs(temp_dir, exist_ok=True)
with zipfile.ZipFile(input_file, 'r') as zf:
    zf.extractall(temp_dir)

# Recompress with deflate
os.remove(input_file)
with zipfile.ZipFile(input_file, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(temp_dir):
        for file in files:
            file_path = os.path.join(root, file)
            zf.write(file_path, os.path.relpath(file_path, temp_dir))

# Cleanup
import shutil
shutil.rmtree(temp_dir)
print(f"Recompressed: {os.path.getsize(input_file) / 1024:.1f} KB")
EOF
```

| Before | After | Reason |
|--------|-------|--------|
| ~2.5MB | ~400KB | SuperDoc uses `Stored` (0% compression); recompress uses `Deflate` (80-90%) |

---

## Delete-and-Insert Principle

**When deleting a provision, ALWAYS assess whether a replacement is needed.**

```
DELETE provision → ASSESS equivalent needed → INSERT if appropriate
```

Example: Deleting UK VAT provisions? Insert Singapore GST provisions.

---

## Handling Large Documents (>100K tokens)

### Option 1: Section-Based Multi-Agent

Split by section, each agent produces edits, then merge:

```bash
node superdoc-redline.mjs merge \
  edits-definitions.json edits-warranties.json \
  -o merged-edits.json -c combine -v contract.docx
```

See **CONTRACT-REVIEW-AGENTIC-SKILL.md** for full orchestrator workflow.

### Option 2: Progressive Chunked Review

Process sequentially, accumulating edits in a master list.

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| **Vague directions** ("change to equivalent") | Draft EXACT replacement text immediately |
| **Skipping discovery pass** | Always complete Pass 1 before Pass 2 |
| **Missing compound terms** | Search definitions for terms containing base terms |
| **Definition blocks not deleted** | Definitions audit catches these |
| **Delete without insert** | Assess if equivalent provision needed |
| **Wrong edit format** | Use `operation` not `type`; use `newText` not `text` |
| **Partial block text** | `newText` must contain ENTIRE block content |
| **Misusing diff modes** | `diff: true` for surgical edits only |

---

## Edit File Format Reference

### Required Edit JSON Schema

Each edit object MUST use these EXACT field names:

```json
{
  "blockId": "b149",           // REQUIRED: Block ID from IR (e.g., "b001", "b149")
  "operation": "replace",      // REQUIRED: "replace", "delete", "comment", or "insert"
  "newText": "Full text...",   // REQUIRED for replace: The complete replacement text
  "diff": true,                // OPTIONAL: Use word-level diff (default: true)
  "comment": "Explanation"     // OPTIONAL: Comment explaining the change
}
```

### Field Names - CRITICAL

| Field | Required For | Description |
|-------|-------------|-------------|
| `blockId` | replace, delete, comment | Target block ID (e.g., "b001") |
| `afterBlockId` | insert | Block to insert after |
| `operation` | ALL | Must be: `replace`, `delete`, `comment`, `insert` |
| `newText` | replace | Full replacement text for the block |
| `text` | insert | Content to insert |
| `comment` | comment operation | Comment text |
| `diff` | replace (optional) | Word-level diff mode (default: true) |

### Common Format Errors (WILL FAIL VALIDATION)

| WRONG Field Name | CORRECT Field Name |
|------------------|-------------------|
| `"searchText"` | NOT USED - delete this field |
| `"replaceText"` | `"newText"` |
| `"type"` | `"operation"` |
| `"text"` (for replace) | `"newText"` |
| `"search"`, `"replace"` | Use `"newText"` with full block content |
| `"oldText"` | NOT USED for edits (only for validation) |

**Correct structure:**
```json
{
  "blockId": "b149",
  "operation": "replace",
  "newText": "[FULL REPLACEMENT TEXT]",
  "diff": true,
  "comment": "Explanation"
}
```

### Validation Errors and Warnings

The validator may report:

| Error/Warning | Meaning | Solution |
|---------------|---------|----------|
| `missing_field: newText` | Using wrong field name | Use `newText` not `replaceText`/`searchText` |
| `Significant content reduction` | newText much shorter | Expected for jurisdiction conversion - ignore if intentional |
| `Ends with trailing comma` | Only flagged if original doesn't end with comma | If both end with comma, this is valid |
| `content_corruption` | Garbled text patterns | Check for copy-paste errors |

---

## Jurisdiction-Specific References

For detailed mappings when converting between jurisdictions, see:
- Internal reference (not published): `tests_and_others/reference/uk-to-singapore.md`

Create similar reference files for other jurisdiction pairs as needed.

---

## Session Learnings

### 4 February 2026 - Asset Purchase Agreement - UK to Singapore

**What worked:**
- Two-pass workflow identified all UK-specific provisions
- Validation caught format errors before document corruption
- 105 edits successfully applied

**Key errors encountered:**

1. **Edit format field name** - Used `"type"` instead of `"operation"`. All edits failed validation.

2. **Block ID confusion from grep** - Grep output line numbers (e.g., `1339:`) were mistaken for block IDs. Always verify block IDs against `blockCount` from stats.

3. **Large chunk handling** - Chunk JSON exceeded 25K tokens. Use `--format text` or grep within output files.

4. **Output file size bloat** - SuperDoc writes DOCX without compression (2.5MB instead of 400KB). Always recompress the output file.

5. **Truncated newText** - LLM output can be truncated, especially for long JSON values. The apply command now validates newText and warns about:
   - Significant content reduction (> 50%)
   - Incomplete sentences (ends mid-word)
   - JSON truncation patterns (trailing comma, unclosed quote)
   - Garbled content patterns (e.g., "4.3S$")

   Use `--strict` to fail the apply if any warnings are detected.

**Command sequence that works:**
```bash
node superdoc-redline.mjs read --input doc.docx --stats-only
node superdoc-redline.mjs extract --input doc.docx --output doc-ir.json
node superdoc-redline.mjs validate --input doc.docx --edits edits.json
node superdoc-redline.mjs apply --input doc.docx --output out.docx --edits edits.json --strict
# Then recompress (see Step 5 above)
```

**Apply options:**
- `--strict` - Treat truncation/corruption warnings as errors (recommended)
- `--verbose` - Enable detailed logging for debugging

---

*Last updated: 5 February 2026*
