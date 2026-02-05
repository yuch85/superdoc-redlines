---
name: Contract Review Agentic Skill
description: Orchestrator-subagent methodology for parallel contract review using superdoc-redlines
---

# Contract Review Agentic Skill

## Overview

This skill enables **multi-agent contract review** using an orchestrator-subagent architecture. The orchestrator coordinates multiple work partitions working on different sections, then merges their edits.

**Prerequisites:** This skill builds on [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md). You must understand the core methodology (two-pass workflow, edit formats, Context Document) before using this agentic approach.

**Note:** In Claude Code, work partitions execute **sequentially** (not in parallel). The organizational benefits remain: clear separation of concerns, smaller focused edit files, and explicit merge/conflict handling.

### When to Use Multi-Agent Workflow

| Document Size | Approach |
|---------------|----------|
| < 30K tokens | Single-agent may be sufficient |
| 30K - 50K tokens | 2-3 work partitions recommended for organizational clarity |
| 50K - 150K tokens | 2-4 work partitions |
| > 150K tokens | 4-8 work partitions |

**Benefits even for smaller documents:**
- Organizational clarity (separating definitions from warranties from schedules)
- Reduced context window pressure
- Clearer edit attribution and review

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR AGENT                           │
│  - Discovery Pass (read all chunks, build Context Document)         │
│  - Work decomposition (assign block ranges to work partitions)      │
│  - Merge results and validate                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     WORK PARTITION A    │
                    │     b001-b300           │ ──► edits-a.json
                    │     (Definitions)       │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     WORK PARTITION B    │
                    │     b301-b600           │ ──► edits-b.json
                    │     (Provisions)        │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     WORK PARTITION C    │
                    │     b601-b900           │ ──► edits-c.json
                    │     (Warranties)        │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │    MERGE & VALIDATE     │
                    │    → APPLY              │
                    └─────────────────────────┘
```

---

## Phase 1: Orchestrator Discovery

The orchestrator completes a **full discovery pass** before spawning work partitions.

### Step 1.1: Get Stats & Extract IR

```bash
node superdoc-redline.mjs read --input contract.docx --stats-only
node superdoc-redline.mjs extract --input contract.docx --output contract-ir.json
```

### Step 1.2: Read All Chunks

```bash
node superdoc-redline.mjs read --input contract.docx --chunk 0 --max-tokens 10000
# ... continue until hasMore: false
```

### Step 1.3: Build Context Document

See [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md) for the Context Document template. For agentic workflow, add:

```markdown
## Work Partition Assignments
| Partition | Block Range | Section | Key Tasks |
|-----------|-------------|---------|-----------|
| A | b001-b300 | Definitions | Term changes, deletions |
| B | b301-b600 | Provisions | Core provisions |
| C | b601-b900 | Warranties | Warranties, schedules |

## Items Requiring DELETE (with assigned partition)
| Term | Block | Assigned Partition |
|------|-------|-------------------|
| [Term] | b### | A |
```

---

## Phase 2: Work Decomposition

### Block Range Assignment Best Practices

> **⚠️ Critical: Clause-Type Distribution**
>
> Block numbers are sequential through the document, but clause types are NOT. Definitions may reference governing law; warranties may contain jurisdiction-specific terms; schedules may duplicate main document provisions.
>
> **Never assign ranges purely by sequential position.** First map clause types to actual block locations during discovery.

### Discovery-First Assignment (Required)

Before assigning ranges, the orchestrator MUST map clause types to actual block locations:

```markdown
## Clause Location Map (Built During Discovery)

| Clause Type | Block IDs | Section Name |
|-------------|-----------|--------------|
| Definitions | b001-b300 | Clause 1 |
| Governing Law | b651, b658, b680, b681 | Clause 24 |
| Jurisdiction | b682-b695 | Clause 25 |
| Employment | b450-b480, b720-b750 | Clauses 12, Schedule 4 |
| Tax Provisions | b380-b420, b850-b900 | Clauses 9, Schedule 7 |
| Boilerplate | b1100-b1200 | Clauses 26-30 |
```

Then assign partitions by **clause type grouping**, not sequential ranges:

```markdown
## Partition Assignments (By Clause Type)

### Partition A: Definitions & Terms
- Blocks: b001-b300
- Also: Any blocks referencing defined terms
- Output: edits-definitions.json

### Partition B: Jurisdiction-Sensitive Clauses
- Blocks: b651, b658, b680-b695, b1100-b1150
- Includes: Governing law, jurisdiction, service of process
- Output: edits-jurisdiction.json

### Partition C: Employment & Related
- Blocks: b450-b480, b720-b750
- Includes: Employment provisions wherever they appear
- Output: edits-employment.json
```

### Assignment Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| **Clause-Type Based** (Recommended) | Group blocks by legal clause type, even if non-contiguous | Complex amendments, jurisdiction conversions |
| **Section-Based** | Assign contiguous block ranges by document structure | Simple documents with clear section boundaries |
| **Topic-Based** | Assign specific amendment categories across document | Focused amendments (e.g., "only tax provisions") |

### Include Buffer Zones for Discovery

When clause boundaries are ambiguous, include buffer zones for discovery (not for edits):

```markdown
### Partition A: Definitions
- Discovery range: b001-b320 (includes buffer)
- Edit range: b001-b300 (strict, no overlap)

### Partition B: Provisions
- Discovery range: b280-b620 (includes buffer)
- Edit range: b301-b600 (strict, no overlap)
```

**Final edit files must have NON-OVERLAPPING block assignments.** Use `-c error` during merge to catch accidental overlaps.

### Anti-Pattern: Sequential-Only Assignment

❌ **Don't do this:**
```markdown
Partition A: b001-b400
Partition B: b401-b800
Partition C: b801-b1200
```

This ignores clause type distribution and will miss edits when:
- Governing law appears in multiple places
- Defined terms are referenced throughout
- Schedules repeat main document language

---

## Phase 3: Spawn Work Partitions

Each work partition receives:
1. The **Context Document** (global context)
2. Their **assigned block range**
3. **Specific instructions**

### Work Partition Prompt Template

```markdown
You are a contract review work partition.

## Your Assignment
- **Block Range**: b[START] to b[END]
- **Section**: [SECTION NAME]
- **Output File**: edits-[section].json

## Context Document
[PASTE FULL CONTEXT DOCUMENT]

## Instructions
1. Read your assigned chunks:
   ```bash
   node superdoc-redline.mjs read --input contract.docx --chunk [N] --max-tokens 10000
   ```

2. For each block, assess amendments based on Context Document.

3. Draft EXACT replacement text (not vague directions).

4. Check "Items Requiring DELETE" - if any are in your range, create DELETE edits.

5. Check "Compound Defined Terms" - change these in your range.

6. Create edits file (markdown or JSON format).

7. Before finalizing, verify:
   - [ ] All DELETEs in my range created
   - [ ] All compound terms in my range changed
   - [ ] All term usages in my range updated

## Output
Report: edit count, deletions made, compound terms changed, any issues.
```

### Execution in Claude Code

Work partitions execute sequentially:

1. Work on Partition A's block range → create `edits-definitions.json`
2. Work on Partition B's block range → create `edits-provisions.json`
3. Work on Partition C's block range → create `edits-warranties.json`
4. Merge all files together

**Empty Edit Files Are Valid:** If a work partition's block range contains no content requiring changes, an empty edit file is acceptable.

---

## Phase 4: Merge & Validate

### Step 4.1: Collect Edit Files

```bash
ls edits-*.json
```

### Step 4.2: Merge

```bash
node superdoc-redline.mjs merge \
  edits-definitions.json edits-provisions.json edits-warranties.json \
  -o merged-edits.json \
  -c error \
  -v contract.docx
```

**Conflict strategies:**
| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `error` | **Recommended.** Fail on conflicts | Forces manual review of overlapping edits |
| `first` | Keep first edit (by file order) | When file order represents priority |
| `last` | Keep last edit (by file order) | When later files should override |
| `combine` | Merge comments; use `first` for other ops | **Caution:** May keep truncated edits |

> **⚠️ Why `-c error` is recommended:** The `combine` strategy can silently keep truncated or corrupt edits when two partitions edit the same block. Use `-c error` to detect conflicts, then resolve manually.

### Step 4.3: Pre-Apply Verification

- [ ] Every DELETE in Context Document has an edit
- [ ] Every compound term has an edit
- [ ] No residual terms in newText fields

### Step 4.4: Validate & Apply

```bash
node superdoc-redline.mjs validate --input contract.docx --edits merged-edits.json
node superdoc-redline.mjs apply -i contract.docx -o amended.docx -e merged-edits.json --strict
```

**Apply options:**
- `--strict` - Treat truncation/corruption warnings as errors (recommended)
- `--verbose` - Enable detailed logging for debugging
- `--allow-reduction` - Allow intentional content reduction
- `--skip-invalid` - Continue applying valid edits even if some fail
- `-q, --quiet-warnings` - Suppress content reduction warnings

### Step 4.5: Recompress Output File

**⚠️ SuperDoc writes uncompressed DOCX files (~6x larger).** See [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md) "Step 5: Recompress Output File".

---

## Orchestrator Checklist

```markdown
### Phase 1: Discovery
- [ ] Get stats, extract IR
- [ ] Read ALL chunks
- [ ] Build Context Document with partition assignments
- [ ] Identify all DELETEs and assign to partitions
- [ ] Build clause location map

### Phase 2: Decomposition
- [ ] Define block ranges by clause type (non-overlapping for edits)
- [ ] Prepare work partition prompts

### Phase 3: Execute
- [ ] Process all work partitions
- [ ] Each has Context Document + block range

### Phase 4: Collect
- [ ] Verify each partition reported DELETEs and compound terms

### Phase 5: Merge & Apply
- [ ] Merge all edits with -c error
- [ ] Pre-apply verification
- [ ] Validate
- [ ] Apply
- [ ] Recompress output file
- [ ] Post-apply verification
```

---

## Global Constraints

Work partitions must respect constraints from the Context Document:

1. **Defined Terms Consistency** - Apply changes from "Terms to Change" table
2. **Citation Format** - Use consistent format for statute references
3. **Delete-and-Insert** - When deleting, assess if insertion needed
4. **Cross-Reference Preservation** - Don't break clause references

---

## Error Handling

| Issue | Resolution |
|-------|------------|
| Work partition timeout | Re-spawn with remaining range, or orchestrator processes directly |
| Merge conflict | Review both edits, use appropriate conflict strategy |
| Validation failure | Fix problematic edits (invalid blockId, etc.), re-validate |

---

## Context Management for Large Documents

> **⚠️ Prompt Too Long Failures**
>
> Multi-agent review can fail with "Prompt is too long" during orchestration when the Context Document becomes too large.

### Prevention Strategies

**1. Summarize Context Document for Work Partitions**
```markdown
## Condensed Context for Work Partitions

### Key Term Mappings (for all partitions)
| Original | New |
|----------|-----|
| [Term A] | [New A] |
| [Term B] | [New B] |

### Partition-Specific Assignments
[Only include blocks relevant to this partition]
```

**2. Limit Work Partition Context**
Work partitions receive only:
- Their assigned block range
- Term mappings relevant to that range
- NOT the full Context Document with all chunks summarized

**3. For Documents >100K Tokens**
Consider running orchestrator and work partitions as separate sessions to avoid context accumulation.

---

## Block ID Verification (CRITICAL)

Before creating edits for a block:
1. Read the relevant chunk containing that block
2. Verify the block ID matches expected content
3. Use the `find-block` command or grep to verify:

```bash
# Find blocks containing specific text
node superdoc-redline.mjs find-block --input contract.docx --text "term"

# Or use grep on IR file
grep -B2 "expected text" contract-ir.json
```

Block IDs can be off by 5-10 positions from estimates. **Always verify.**

### Best Practices for Work Partitions

1. **Before creating any edit**, verify the block exists and contains expected text
2. **Use find-block command** when uncertain about block locations
3. **Report verification failures** back to orchestrator for reassignment
4. **Include verification notes** in edit comments for traceability

---

## Coverage Verification Checklist

For comprehensive reviews, **draft a Coverage Verification Checklist** specific to your amendment task. This checklist should include:

### Definitions Section
- [ ] All source-specific statute definitions identified
- [ ] Replacement statute definitions drafted
- [ ] Terms with no equivalent flagged for deletion

### Throughout Document (trace every usage)
- [ ] Every instance of [Source Term A] → [Target Term A]
- [ ] Every instance of [Source Term B] → [Target Term B]
- [ ] Every source statute reference updated
- [ ] Every source regulatory body reference updated

### Deletion Candidates
- [ ] Provisions with no target equivalent identified
- [ ] Automatic transfer provisions (if target requires consent)
- [ ] Source-specific regulatory provisions

### Post-Apply Verification
```bash
# Run grep for residual source terms
grep -i "[SOURCE_TERM_1]\|[SOURCE_TERM_2]" amended-contract.docx
# Any unexpected hits indicate missed edits
```

**Key:** Invest in schedule and appendix discovery - these sections often duplicate main document provisions and contain additional instances of terms requiring change.

---

## Reference

- **Core methodology:** [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md)
- **Edit format:** See "Edit File Format Reference" in CONTRACT-REVIEW-SKILL.md
- **Tool documentation:** [SKILL.md](../SKILL.md) and [README.md](../README.md)

---

*Last updated: 5 February 2026*
