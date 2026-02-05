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

**Use single-agent when:**
- You can read the document and create all edits without context pressure
- The amendment scope is narrow (only governing law, only one term)
- You have enough context window for both discovery AND edit creation

**Consider multi-agent when:**
- You're running into context limits during edit creation
- You want organizational separation (definitions vs provisions vs schedules)
- Different sections need different treatment approaches
- Document is >50K tokens and has many edits needed

**The real signal is context pressure**, not arbitrary token thresholds. If single-agent works comfortably, use it. If you're running out of room, split the work.

**Benefits of multi-agent (even for smaller documents):**
- Organizational clarity (separating definitions from warranties from schedules)
- Smaller, focused edit files are easier to review
- Clearer edit attribution
- Explicit merge/conflict handling

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
                    │     b001-b300           │ ──► edits-a.md
                    │     (Definitions)       │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     WORK PARTITION B    │
                    │     b301-b600           │ ──► edits-b.md
                    │     (Provisions)        │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     WORK PARTITION C    │
                    │     b601-b900           │ ──► edits-c.md
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

**Chunk Count Estimation:**

The `recommendedChunksByLimit` provides estimates that may be 1.5-2x lower than actual chunk counts due to block boundary preservation logic.

| Estimate Type | Example (43K token doc) |
|---------------|-------------------------|
| Simple estimate | 5 chunks |
| Adjusted estimate | 8 chunks |
| **Actual chunks** | 14 chunks |

**Planning guidance:**
- Multiply adjusted estimate by 1.75 for planning purposes
- For discovery pass, budget tokens for: `adjusted_chunks × 1.75 × tokens_per_chunk`
- Example: 8 adjusted × 1.75 × 10K = 140K tokens needed for exhaustive discovery

This is expected behavior, not a bug. The chunking algorithm prioritizes preserving block boundaries over hitting exact token targets.

### Step 1.2: Read All Chunks

```bash
node superdoc-redline.mjs read --input contract.docx --chunk 0 --max-tokens 10000
# ... continue until hasMore: false
```

#### State File Pattern for Discovery

**Problem:** Full discovery means reading all chunks, but keeping chunk content in context exhausts the token budget for edit creation.

**Solution:** As you read each chunk, append findings to a persistent state file:

1. Read chunk 0 → Extract findings → Append to `context-document.md`
2. Read chunk 1 → Extract findings → Append to `context-document.md`
3. Continue until all chunks processed
4. `context-document.md` now contains complete findings

**The chunk content leaves context, but findings persist in the file.**

```markdown
# Context Document: Asset Purchase Agreement

## Chunk 0 Findings (b001-b100)
- "VAT" defined in b045
- "Business Day" references UK in b067

## Chunk 1 Findings (b101-b200)
- "Companies Act" referenced in b145, b167
- TUPE provisions: b180-b195
```

**Combined with find-block:**
- Use `find-block --regex "VAT|HMRC|Companies House"` to locate blocks first
- Only read chunks containing relevant blocks
- Skip chunks with no matches

This approach achieves comprehensive coverage with 25-35% token usage vs 60-75% for exhaustive in-context reading.

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

### Block Range Assignment

#### Simple Sequential (Default - Works Fine)

For most documents, divide blocks evenly by sequential ranges:

```markdown
## Partition Assignments (Sequential)

### Partition A: b001-b450
- Section: Parties, Definitions, Interpretation
- Output: edits-definitions.md

### Partition B: b451-b900
- Section: Main provisions, Warranties
- Output: edits-provisions.md

### Partition C: b901-b1337
- Section: Schedules
- Output: edits-schedules.md
```

**As long as all partitions share the same Context Document** with term mappings, each partition applies the same rules to their blocks. Nothing is missed - if "VAT" appears in b350, Partition A edits it; if "VAT" also appears in b700, Partition B edits it. Both follow the Context Document rules.

#### Partition Size Targets

- Aim for roughly equal block counts for balanced workload
- 200-500 blocks per partition is typical
- Adjust based on actual content density (schedules may need fewer blocks per partition)

#### Clause-Type Grouping (Optional)

Use non-sequential assignment only when different clause types genuinely need different treatment:

```markdown
## Partition Assignments (By Clause Type)

### Partition A: Definitions & Terms
- Blocks: b001-b300
- Output: edits-definitions.md

### Partition B: Jurisdiction-Sensitive Clauses
- Blocks: b651-b695, b1100-b1150
- Includes: Governing law, jurisdiction, service of process
- Output: edits-jurisdiction.md

### Partition C: Employment & Related
- Blocks: b450-b480, b720-b750
- Needs specialist review
- Output: edits-employment.md
```

| Strategy | Best For |
|----------|----------|
| **Sequential** (Default) | Most amendments - simple and works |
| **Clause-Type Based** | When different clauses need different expertise |
| **Topic-Based** | Focused amendments (e.g., "only tax provisions") |

**Final edit files must have NON-OVERLAPPING block assignments.** Use `-c error` during merge to catch accidental overlaps.

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
- **Output File**: edits-[section].md

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

6. Create edits file in **markdown format** (recommended for resilience).

7. Before finalizing, verify:
   - [ ] All DELETEs in my range created
   - [ ] All compound terms in my range changed
   - [ ] All term usages in my range updated

## Output
Report: edit count, deletions made, compound terms changed, any issues.
```

### Execution in Claude Code

Work partitions execute sequentially:

1. Work on Partition A's block range → create `edits-definitions.md`
2. Work on Partition B's block range → create `edits-provisions.md`
3. Work on Partition C's block range → create `edits-warranties.md`
4. Merge all files together

**Empty Edit Files Are Valid:** If a work partition's block range contains no content requiring changes, an empty edit file is acceptable.

---

## Phase 4: Merge & Validate

### Step 4.1: Collect Edit Files

```bash
ls edits-*.md
```

### Step 4.2: Merge

```bash
node superdoc-redline.mjs merge \
  edits-definitions.md edits-provisions.md edits-warranties.md \
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

## Token Budget Management

### Budget Allocation (for 200K context window)

| Phase | Allocation | Purpose |
|-------|------------|---------|
| Discovery | 30% (60K) | Read chunks, build Context Document |
| Edit creation | 60% (120K) | Create partition edit files |
| Overhead/merge | 10% (20K) | Merge, validate, apply |

### Discovery Optimization

**High-edit runs (50+ edits)** achieved with strategic discovery:
- Use `find-block --regex "pattern1|pattern2|pattern3"` instead of reading all chunks
- Read only 2-3 representative chunks per section
- Query IR file for term frequencies
- Save remaining tokens for comprehensive edit creation
- **Token usage:** 25-35% of budget

**Low-edit runs (16-35 edits)** with exhaustive discovery:
- Read all chunks sequentially
- Higher context pressure during edit creation
- **Token usage:** 60-75% of budget

### Edit Creation Optimization

- Create partition edit files in markdown format
- Use `parse-edits` to convert (faster than JSON authoring)
- Focus on clause-type groupings (enables larger edit sets per partition)

### Signs You Should Optimize

- Context usage >70% during discovery
- Unable to read all schedule blocks
- Partition creation feeling rushed
- "Prompt too long" errors

**Solution:** Switch to strategic discovery using find-block + state file pattern.

---

## Reference

- **Core methodology:** [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md)
- **Edit format:** See "Edit File Format Reference" in CONTRACT-REVIEW-SKILL.md
- **Tool documentation:** [SKILL.md](../SKILL.md) and [README.md](../README.md)

---

*Last updated: 5 February 2026*
