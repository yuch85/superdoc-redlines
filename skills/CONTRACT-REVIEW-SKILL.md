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
> This document uses jurisdiction conversion as a running example. The specific examples are purely illustrative.
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
| "Change [City A] to [City B]" | `newText: "...banks in [City B] are open for business."` |
| "Update to local Companies Act" | `newText: "Companies Act: the Companies Act [Year] of [Jurisdiction]."` |

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
| Original | New | Def Block | Usage Blocks | Partition | Amended? |
|----------|-----|-----------|--------------|-----------|----------|
| [term] | [new] | b### | b###, b###... | A | [ ] |

## 2. Compound Defined Terms
| Compound Term | Contains | Def Block | New Term | Partition |
|---------------|----------|-----------|----------|-----------|
| [term] | [base] | b### | [new] | A |

## 3. Definitions to DELETE (no equivalent)
| Term | Def Block | Partition | Delete Edit Created? |
|------|-----------|-----------|---------------------|
| [term] | b### | A | [ ] |

## 4. Provisions to Delete + Insertions Needed
| Block | Provision | Delete? | Insert Equivalent? | Partition |
|-------|-----------|---------|-------------------|-----------|
| b### | [desc] | Yes | Yes/No | B |

## 5. Cross-References Map
| Reference | Target | Block IDs |
|-----------|--------|-----------|
| "clause 1" | Definitions | b###, b### |

## 6. Chunks Summary
| Chunk | Block Range | Key Sections |
|-------|-------------|--------------|
| 0 | b001-b150 | Parties, Recitals |
```

**Note:** The `Partition` column indicates which work partition is responsible for amending this term (for multi-agent workflow). This prevents duplicate edits and ensures comprehensive coverage. For single-agent workflow, you can omit this column.

### Step 1.3: Definitions Audit (CRITICAL)

**⚠️ MANDATORY.** Scan the Definitions section and:
1. List EVERY defined term
2. Flag terms for DELETE (no equivalent in target context)
3. Identify compound terms (e.g., "Tax Records" contains "Tax")
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
**Category:** [Category]
**Diff Mode:** true
**Current:** "...original text here..."
**Exact New Text:** "...replacement text here..."
**Rationale:** [Reason for change]

### Amendment 2 (Block b257)
**Action:** DELETE
**Current:** "Definition: the [Original Statute]..."
**Rationale:** No equivalent in target context
```

### Step 2.2: Mark Progress in Context Document

After each chunk, update the Context Document to track which terms/blocks have been amended.

---

## Creating the Edits File

### Markdown Format (Recommended for >30 edits)

```markdown
# Edits

## Metadata
- **Version**: 0.2.0
- **Author Name**: AI Legal Counsel
- **Author Email**: ai@counsel.example.com

## Edits Table
| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b257 | delete | - | DELETE: no equivalent |
| b165 | replace | true | Jurisdiction change |

## Replacement Text

### b165 newText
Business Day: a day other than a Saturday, Sunday or public holiday in [Location] when banks in [Location] are open for business.
```

#### Converting Markdown to JSON

For large edit sets, create edits in markdown format, then convert to JSON using:

```bash
node superdoc-redline.mjs parse-edits --input edits.md --output edits.json
```

**Important notes:**
- The `## Edits Table` defines operations; `## Replacement Text` provides content
- Each `### blockId newText` section contains full replacement text (multi-line OK)
- Do NOT add `## sections` after `## Replacement Text` — the parser will include them in the last edit's newText
- You can apply markdown files directly without conversion: `apply -e edits.md`

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

### List Item Punctuation Rules

When editing list items, preserve the original punctuation pattern:

**Semicolon-delimited lists:**
- First N-1 items end with `;`
- Second-to-last item ends with `; and` or `; or`
- Final item ends with `.`

**Example:**
```
(a) the first item;
(b) the second item; and
(c) the final item.
```

**When editing:**
- If editing items (a) or (b), preserve `;` and `; and`
- If editing item (c), preserve `.`
- Never change punctuation unless explicitly instructed

**Validation:** The validator may warn if final punctuation changes. Verify any punctuation changes are intentional before applying.

---

## Execution Workflow

### Step 1: Pre-Apply Verification

Before applying, verify against Context Document:

**1. Content Verification**
- [ ] All DELETE items have edits
- [ ] All compound terms changed
- [ ] No residual terms in newText that should have been changed
- [ ] No placeholder text like "[TBD]" or "[TODO]" in newText

**2. Punctuation Verification**
- [ ] List items maintain correct punctuation (`;` vs `.` vs `; and`)
- [ ] Sentences end with periods
- [ ] No accidental punctuation changes

**3. Block ID Verification**
- [ ] All block IDs exist in document (run `validate` to check)
- [ ] No duplicate block IDs across partitions (if multi-agent)

**4. Diff Mode Verification**
- [ ] `diff: true` for surgical edits (few words changed)
- [ ] `diff: false` for complete rewrites (>50% changed)

**5. Review Validation Output**
```bash
node superdoc-redline.mjs validate --input contract.docx --edits edits.json 2>&1 | grep -E "warning|error|issue"
```

- [ ] All validation warnings reviewed and understood
- [ ] Content reduction warnings justified (or use `--allow-reduction`)
- [ ] No TOC block edits that will fail

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

**Important:** When using track changes mode, post-apply verification via grep/find-block will find ALL original terms because deleted text is preserved. This is expected behavior.

**To verify completeness:**
1. Open amended document in Word
2. Accept all changes (Review > Accept All)
3. Search for residual terms
4. OR use grep/find-block understanding that matches include deleted content

#### Coverage Verification (Recommended)

For comprehensive reviews, verify coverage by counting term occurrences:

```bash
# Count occurrences of a term in the original IR
grep -c '[TERM]' contract-ir.json

# Your edit count should match or exceed this count
# If original has 50 references and you have 45 edits, review for missed blocks
```

**Coverage Thresholds:**
- **>90% coverage required** - For defined term replacements
- **100% coverage required** - For jurisdiction/entity changes
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

2. **Post-apply grep finds "deleted" terms** - If you grep for a term in the amended IR, you'll find it because the deleted text is preserved. This is expected behavior.

3. **To verify deletions, open in Word** - Use Microsoft Word's Review > Track Changes to see deletions with strikethrough.

4. **Accept changes for clean extraction** - To get IR with only the final text, open the DOCX in Word, accept all changes, save, then re-extract.

---

## Delete-and-Insert Principle

**When deleting a provision, ALWAYS assess whether a replacement is needed.**

```
DELETE provision → ASSESS equivalent needed → INSERT if appropriate
```

Example: Deleting jurisdiction-specific provisions? Insert equivalent provisions for the target jurisdiction.

---

## Handling Large Documents (>100K tokens)

### Option 1: Section-Based Multi-Agent

Split by section, each agent produces edits, then merge:

```bash
node superdoc-redline.mjs merge \
  edits-definitions.json edits-warranties.json \
  -o merged-edits.json -c combine -v contract.docx
```

See [CONTRACT-REVIEW-AGENTIC-SKILL.md](./CONTRACT-REVIEW-AGENTIC-SKILL.md) for the full orchestrator workflow.

### Option 2: Progressive Chunked Review

Process sequentially, accumulating edits in a master list.

---

## TOC Block Limitations

Table of Contents blocks cannot be edited with track changes due to deeply nested link structures in ProseMirror.

**Identifying TOC Blocks:**
- Typically located in early blocks of documents with TOC
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

- **Delete:** Use when the entire provision has no equivalent (e.g., jurisdiction-specific statutes with no target equivalent)
- **Replace:** Use when adapting content (e.g., regulatory body A → regulatory body B)

**Note:** Delete operations don't generate comments in track changes. Add a comment edit separately if you need to explain the deletion.

---

## Jurisdiction Conversion Guidance

When converting between jurisdictions, content reduction is often expected:
- Source jurisdiction statutes may be more verbose than target equivalents
- Use `--allow-reduction` flag proactively when reductions are intentional
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
| **Block ID confusion from grep** | Grep line numbers are NOT block IDs - verify against IR |
| **Large chunk JSON exceeds context** | Use `--format text` or grep within output files |
| **Output file size bloat** | Always recompress (SuperDoc writes uncompressed) |
| **Truncated newText** | Use `--strict` to detect; use markdown format for large edits |

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
| `Significant content reduction` | newText much shorter | Expected for some conversions - ignore if intentional |
| `Ends with trailing comma` | Only flagged if original doesn't end with comma | If both end with comma, this is valid |
| `content_corruption` | Garbled text patterns | Check for copy-paste errors |

---

## Finding Block IDs by Content

To find blocks containing specific text, use the `find-block` command:

```bash
# Search by text (case-insensitive)
node superdoc-redline.mjs find-block --input contract.docx --text "term"

# Search by regex
node superdoc-redline.mjs find-block --input contract.docx --regex "term1|term2"

# Search in already-extracted IR (faster for multiple searches)
node superdoc-redline.mjs find-block --input contract-ir.json --text "term"

# Show more results (default is 20)
node superdoc-redline.mjs find-block --input contract.docx --text "term" --limit 100

# Show ALL matches (for comprehensive coverage)
node superdoc-redline.mjs find-block --input contract.docx --text "term" --limit all
```

**Note:** The default limit of 20 results can miss edits for high-frequency terms. For comprehensive discovery, use `--limit all` to see all occurrences.

Alternatively, use grep or jq on the IR file:
```bash
# Using grep (shows context with block IDs)
grep -B5 "term" contract-ir.json | grep -E '"seqId"|"text"'

# Using jq (more precise)
jq '.blocks[] | select(.text | contains("term")) | {seqId, text}' contract-ir.json
```

---

## Validation Warning Decision Tree

When the apply command reports warnings:

### 1. "Significant content reduction (X%)"
- If intentional simplification (jurisdiction conversion, removing obsolete provisions): **ACCEPTABLE**
  - Use `--allow-reduction` flag to suppress these warnings
- If mid-sentence truncation or garbled text: **ERROR** - re-create edit
- Tip: Don't use `--strict` for conversion work with expected reductions

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
| `--allow-reduction` | When intentionally shortening content |

Strict mode exits with code 1 if ANY edit is skipped. For partial success scenarios, omit `--strict`.

---

*Last updated: 5 February 2026*
