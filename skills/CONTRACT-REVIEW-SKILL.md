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

**Note:** The `recommendedChunksByLimit` values are estimates. Actual chunk count may be 1.5-2x higher due to block boundary preservation. Plan for 2-3x the estimated chunks when scheduling discovery passes.

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

#### Coverage Verification (Recommended)

For comprehensive reviews, verify coverage by counting term occurrences:

```bash
# Count occurrences of a term in the original IR
grep -c 'VAT' contract-ir.json

# Your edit count for VAT->GST should match or exceed this count
# If original has 50 VAT references and you have 45 VAT->GST edits, review for missed blocks
```

**Coverage Thresholds:**
- **>90% coverage required** - For defined term replacements (VAT->GST, HMRC->IRAS)
- **100% coverage required** - For jurisdiction changes (England->Singapore)
- **Acceptable gaps** - Blocks within deleted sections don't need edits

### Step 5: Recompress Output File

**⚠️ The SuperDoc library writes DOCX files without compression**, resulting in files ~6x larger than expected.

**Before first use of recompress:**
```bash
cd /path/to/superdoc-redlines
npm install archiver unzipper
```

Use the built-in recompress command:
```bash
node superdoc-redline.mjs recompress --input amended.docx
```

Or use Python to recompress:

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

## Understanding Track Changes Mode

When applying edits with superdoc-redlines, the output DOCX uses **track changes** (revisions):

| Operation | What Happens | How It Appears in Word |
|-----------|--------------|------------------------|
| **Replace** | Old text marked deleted, new text inserted | Old = strikethrough, New = underlined |
| **Delete** | Text marked as deleted (not physically removed) | Text appears with strikethrough |
| **Insert** | New block added with insertion mark | New text appears underlined |

### Key Implications

1. **Deleted text still appears in IR extraction** - Because track changes preserves deleted content, extracting IR from an amended document will show BOTH old and new text concatenated.

2. **Post-apply grep finds "deleted" terms** - If you grep for "VAT" in the amended IR, you'll find it because the deleted VAT text is preserved. This is expected behavior.

3. **To verify deletions, open in Word** - Use Microsoft Word's Review > Track Changes to see deletions with strikethrough.

4. **Accept changes for clean extraction** - To get IR with only the final text, open the DOCX in Word, accept all changes, save, then re-extract.

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

## TOC Block Limitations

Table of Contents blocks cannot be edited with track changes due to deeply nested link structures in ProseMirror.

**Identifying TOC Blocks:**
- Typically located in blocks b001-b150 in documents with TOC
- Text patterns: "1. Introduction.....12" or "Part I\t5"
- Short text with dot leaders or tabs followed by page numbers

**Handling TOC Blocks:**
- Skip these blocks in edit files
- Document TOC changes for manual post-processing
- The apply command will warn when TOC-like blocks are detected

**Error Pattern:**
```
[CommandService] Dispatch failed: Invalid content for node paragraph: <link(run(link(textStyle(trackDelete("X.")))))
```

If you see this error, the block likely has TOC-like link nesting. Skip it and add a note for manual review.

---

## Delete vs Replace Operations

- **Delete:** Use when the entire provision has no equivalent (e.g., TULRCA, TUPE definitions, inheritance tax clauses)
- **Replace:** Use when adapting content to new jurisdiction (e.g., VAT→GST, HMRC→IRAS)

**Note:** Delete operations don't generate comments in track changes. Add a comment edit separately if you need to explain the deletion.

---

## Jurisdiction Conversion Flags

When converting between jurisdictions (e.g., UK to Singapore), content reduction is expected:
- UK statutes often have more verbose provisions than Singapore equivalents
- Use `--allow-reduction` flag proactively
- Use `-q` (quiet) to suppress expected warnings

Example:
```bash
node superdoc-redline.mjs apply --input doc.docx --edits merged.json \
  --output amended.docx --allow-reduction -q
```

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

## Finding Block IDs by Content

To find blocks containing specific text, use the `find-block` command:

```bash
# Search by text (case-insensitive)
node superdoc-redline.mjs find-block --input contract.docx --text "VAT"

# Search by regex
node superdoc-redline.mjs find-block --input contract.docx --regex "VAT|HMRC"

# Search in already-extracted IR (faster for multiple searches)
node superdoc-redline.mjs find-block --input contract-ir.json --text "VAT"
```

Alternatively, use grep or jq on the IR file:
```bash
# Using grep (shows context with block IDs)
grep -B5 "VAT" contract-ir.json | grep -E '"seqId"|"text"'

# Using jq (more precise)
jq '.blocks[] | select(.text | contains("VAT")) | {seqId, text}' contract-ir.json
```

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
- `--allow-reduction` - Allow intentional content reduction (for jurisdiction conversions)
- `--skip-invalid` - Continue applying valid edits even if some fail
- `-q, --quiet-warnings` - Suppress content reduction warnings

---

## Validation Warning Decision Tree

When the apply command reports warnings:

### 1. "Significant content reduction (X%)"
- If intentional simplification (jurisdiction conversion, removing obsolete provisions): **ACCEPTABLE**
  - Use `--allow-reduction` flag to suppress these warnings
- If mid-sentence truncation or garbled text: **ERROR** - re-create edit
- Tip: Don't use `--strict` for jurisdiction conversion work

### 2. "Possible truncation: ends with..."
- Check if newText makes grammatical sense
- If original ended same way: **FALSE POSITIVE**
- If sentence is incomplete: **ERROR**

### 3. TextSelection endpoint warning
- **IGNORE** - benign ProseMirror internal message
- Does not affect output file

---

## When to Use Strict Mode

| Mode | Use Case |
|------|----------|
| `--strict` | General editing, proofreading, minor corrections |
| NO `--strict` | Jurisdiction conversion, content simplification, provision deletion |
| `--allow-reduction` | When intentionally shortening content (e.g., UK statutes → Singapore equivalents) |

Strict mode exits with code 1 if ANY edit is skipped. For partial success scenarios, omit `--strict`.

---

*Last updated: 5 February 2026*
