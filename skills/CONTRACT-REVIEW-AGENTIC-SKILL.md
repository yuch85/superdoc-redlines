---
name: Contract Review Agentic Skill
description: Orchestrator-subagent methodology for parallel contract review using superdoc-redlines
---

# Contract Review Agentic Skill

## Overview

This skill enables **multi-agent contract review** using an orchestrator-subagent architecture. The orchestrator coordinates multiple work partitions working on different sections, then merges their edits.

**Prerequisites:** This skill builds on [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md). You must understand the core methodology (two-pass workflow, edit formats, Context Document) before using this agentic approach.

**Note:** Claude Code supports **parallel sub-agent execution** via the Task tool (up to 16-20 concurrent agents). This skill is designed to maximize parallelism at every phase — discovery, amendment, and verification all use concurrent agents.

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
│  - Setup: stats + extract IR                                        │
│  - Dispatch parallel pre-scan + discovery agents                    │
│  - Merge findings → master Context Document                         │
│  - Work decomposition (assign block ranges to partitions)           │
│  - Dispatch parallel amendment agents                               │
│  - Merge edits → validate → apply                                   │
│  - Dispatch parallel verification agents                            │
└─────────────────────────────────────────────────────────────────────┘
         │                              │                        │
         ▼ PHASE 1 (parallel)           ▼ PHASE 3 (parallel)    ▼ PHASE 5 (parallel)
┌──────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐
│  Pre-Scan Agents     │  │  Amendment Agents     │  │  Verification Agents  │
│  (find-block search) │  │  (6-8 partitions)     │  │  (term-category check)│
├──────────────────────┤  ├───────────────────────┤  ├───────────────────────┤
│ Search A: regulatory │  │ Agent 1: b001-b200    │  │ Verify A: jurisdict.  │
│ Search B: jurisdict. │  │ Agent 2: b201-b400    │  │ Verify B: statutes    │
│ Search C: statutes   │  │ Agent 3: b401-b600    │  │ Verify C: entities    │
│ Search D: entities   │  │ Agent 4: b601-b800    │  └───────────────────────┘
└──────────────────────┘  │ Agent 5: b801-b1000   │
         │                │ Agent 6: b1001-b1200  │
         ▼                │ Agent 7: b1201-b1337  │
┌──────────────────────┐  └───────────────────────┘
│  Discovery Agents    │             │
│  (parallel chunk     │             ▼
│   reading)           │  ┌───────────────────────┐
├──────────────────────┤  │  MERGE & VALIDATE     │
│ Disc. 1: chunks 0-4  │  │  → APPLY              │
│ Disc. 2: chunks 5-9  │  │  → RECOMPRESS         │
│ Disc. 3: chunks 10+  │  └───────────────────────┘
└──────────────────────┘
         │
         ▼
┌──────────────────────┐
│  Orchestrator merges  │
│  → master-context.md │
└──────────────────────┘
```

---

## Phase 1: Orchestrator Discovery (Parallelized)

The orchestrator uses **parallel agents** to accelerate discovery. Three levels of parallelism are available.

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

### Step 1.2: Parallel Pre-Scan (find-block)

**Before reading any chunks**, spawn parallel search agents to build a term location map. Each agent searches for a different category of terms.

```
Spawn as Batch 1 (3-4 agents simultaneously):
  Search Agent A: find-block --regex "regulatory|compliance|authority" --limit all
  Search Agent B: find-block --regex "jurisdiction|governing law|court" --limit all
  Search Agent C: find-block --regex "statute|act|regulation" --limit all
  Search Agent D: find-block --regex "entity|company|party name" --limit all
```

**Pre-Scan Agent Prompt Template:**

```markdown
You are a pre-scan search agent.

## Assignment
Search the IR file for terms in your category and produce a term location map.

## Procedure
1. Run your assigned find-block searches:
   ```bash
   cd /path/to/superdoc-redlines
   node superdoc-redline.mjs find-block --input contract-ir.json --regex "[PATTERN]" --limit all
   ```

2. For each match, record: block ID, matched text, surrounding context (first 80 chars).

3. Save results to: `prescan-[category].md`

## Output Format
| Block ID | Matched Term | Context (first 80 chars) |
|----------|-------------|--------------------------|
| b045 | VAT | "VAT means Value Added Tax as defined..." |
```

**Result:** A complete map of where every relevant term appears, before reading a single chunk. This lets the orchestrator:
- Know exactly which chunks contain relevant content
- Skip chunks with no matches
- Build accurate partition assignments

**Estimated speedup:** 5-10x faster than sequential `find-block` calls for documents with 10+ search patterns.

### Step 1.3: Parallel Discovery Agents (Chunk Reading)

Instead of the orchestrator reading all chunks sequentially, spawn **parallel discovery agents**, each reading a subset of chunks.

```
Spawn as Batch 2 (after pre-scan completes, 2-4 agents simultaneously):
  Discovery Agent 1: Read chunks 0-4  → findings-1.md
  Discovery Agent 2: Read chunks 5-9  → findings-2.md
  Discovery Agent 3: Read chunks 10+  → findings-3.md
```

**How many discovery agents?**

| Total Chunks | Discovery Agents | Chunks Per Agent |
|--------------|------------------|------------------|
| 5-8          | 2                | 3-4              |
| 9-14         | 3                | 3-5              |
| 15-20        | 4                | 4-5              |
| 20+          | 5-6              | 4-5              |

**Discovery Agent Prompt Template:**

```markdown
You are a discovery agent. Read your assigned chunks and extract findings.

## Assignment
- Chunks: [START] to [END]
- IR File: contract-ir.json
- Pre-Scan Results: Read from /path/to/superdoc-redlines/prescan-*.md
- Output: findings-[N].md

## Procedure
1. Read each assigned chunk:
   ```bash
   cd /path/to/superdoc-redlines
   node superdoc-redline.mjs read --input contract.docx --chunk [N] --max-tokens 10000
   ```

2. For each chunk, extract:
   - Defined terms (term, block ID, definition text)
   - Term usage locations (block IDs where defined terms appear)
   - Provisions requiring change (block ID, description, category)
   - Provisions to DELETE (block ID, reason)
   - Cross-references to other clauses

3. Save to: findings-[N].md

## Output Format
```
# Discovery Findings: Chunks [START]-[END]

## Defined Terms Found
| Term | Block | Definition (first 80 chars) |
|------|-------|----------------------------|

## Term Usages
| Term | Usage Blocks |
|------|-------------|

## Provisions to Change
| Block | Category | Description |
|-------|----------|-------------|

## Provisions to DELETE
| Block | Reason |
|-------|--------|

## Cross-References
| Reference | Target | Block IDs |
|-----------|--------|-----------|
```

## Rules
- ONLY read chunks in your assigned range
- Record ALL defined terms, even if they seem unrelated
- Include block IDs for EVERY finding
```

**Result:** All chunks read concurrently. ~3x faster discovery for a 14-chunk document.

### Step 1.4: Orchestrator Merges Findings

After all discovery agents complete, the orchestrator:

1. **Reads all `findings-*.md` and `prescan-*.md` files**
2. **Deduplicates defined terms** (same term found by multiple agents)
3. **Merges usage locations** (term defined in Agent 1's range, used in Agent 2's range)
4. **Resolves cross-references** across chunk boundaries
5. **Builds the master `context-document.md`**

#### State File Pattern

Even with parallel discovery, the state file pattern remains important for the orchestrator's merge step:

```markdown
# Context Document: Asset Purchase Agreement

## Chunk 0-4 Findings (from Discovery Agent 1)
- "VAT" defined in b045
- "Business Day" references UK in b067

## Chunk 5-9 Findings (from Discovery Agent 2)
- "Companies Act" referenced in b145, b167
- TUPE provisions: b180-b195

## Chunk 10+ Findings (from Discovery Agent 3)
- Schedule references to "VAT" in b850, b920
- Additional "Companies Act" references in b1100
```

### Step 1.5: Build Context Document

See [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md) for the Context Document template. For agentic workflow, add:

```markdown
## Work Partition Assignments
| Partition | Block Range | Section | Key Tasks |
|-----------|-------------|---------|-----------|
| 1 | b001-b200 | Definitions Pt 1 | Term changes, deletions |
| 2 | b201-b400 | Definitions Pt 2 | Term changes, provisions |
| 3 | b401-b600 | Main Provisions | Core provisions |
| 4 | b601-b800 | Warranties | Warranties, indemnities |
| 5 | b801-b1000 | Schedules Pt 1 | Schedule amendments |
| 6 | b1001-b1337 | Schedules Pt 2 | Remaining schedules |

## Items Requiring DELETE (with assigned partition)
| Term | Block | Assigned Partition |
|------|-------|-------------------|
| [Term] | b### | 1 |
```

---

## Phase 2: Work Decomposition (6-8 Partitions)

### Partition Count Guidance

With parallel agent support (16-20 concurrent), use **6-8 amendment partitions** for optimal throughput. More partitions = faster completion, but diminishing returns beyond 8 due to merge overhead and context duplication.

| Document Size (blocks) | Recommended Partitions | Blocks Per Partition |
|------------------------|----------------------|---------------------|
| < 300 | 2-3 | 100-150 |
| 300-600 | 4-5 | 100-150 |
| 600-1000 | 6-7 | 100-170 |
| 1000+ | 7-8 | 130-200 |

**Sweet spot:** 100-200 blocks per partition. Smaller partitions complete faster and are easier to validate.

### Block Range Assignment

#### Simple Sequential (Default - Works Fine)

For most documents, divide blocks evenly by sequential ranges:

```markdown
## Partition Assignments (Sequential - 7 Partitions)

### Partition 1: b001-b200
- Section: Parties, Recitals, Definitions Pt 1
- Output: edits-part1.md

### Partition 2: b201-b400
- Section: Definitions Pt 2, Interpretation
- Output: edits-part2.md

### Partition 3: b401-b600
- Section: Conditions, Completion
- Output: edits-part3.md

### Partition 4: b601-b800
- Section: Warranties Pt 1
- Output: edits-part4.md

### Partition 5: b801-b1000
- Section: Warranties Pt 2, Indemnities
- Output: edits-part5.md

### Partition 6: b1001-b1200
- Section: Schedules Pt 1
- Output: edits-part6.md

### Partition 7: b1201-b1337
- Section: Schedules Pt 2
- Output: edits-part7.md
```

**As long as all partitions share the same Context Document** with term mappings, each partition applies the same rules to their blocks. Nothing is missed - if "VAT" appears in b350, Partition 2 edits it; if "VAT" also appears in b700, Partition 4 edits it. Both follow the Context Document rules.

#### Partition Size Targets

- Aim for roughly equal block counts for balanced workload
- **100-200 blocks per partition** is optimal (smaller than before, more agents)
- Adjust based on actual content density (schedules may need fewer blocks per partition)
- Definitions sections are edit-dense; give them smaller block ranges

#### Clause-Type Grouping (Optional)

Use non-sequential assignment only when different clause types genuinely need different treatment:

```markdown
## Partition Assignments (By Clause Type - 6 Partitions)

### Partition 1: Definitions (A-L)
- Blocks: b001-b150
- Output: edits-defs-1.md

### Partition 2: Definitions (M-Z) + Interpretation
- Blocks: b151-b320
- Output: edits-defs-2.md

### Partition 3: Core Provisions
- Blocks: b321-b550
- Output: edits-provisions.md

### Partition 4: Warranties & Indemnities
- Blocks: b551-b780
- Output: edits-warranties.md

### Partition 5: Jurisdiction-Sensitive Clauses
- Blocks: b781-b900
- Includes: Governing law, jurisdiction, service of process
- Output: edits-jurisdiction.md

### Partition 6: Schedules
- Blocks: b901-b1337
- Output: edits-schedules.md
```

| Strategy | Best For |
|----------|----------|
| **Sequential** (Default) | Most amendments - simple and works |
| **Clause-Type Based** | When different clauses need different expertise |
| **Topic-Based** | Focused amendments (e.g., "only tax provisions") |

**Final edit files must have NON-OVERLAPPING block assignments.** Use `-c error` during merge to catch accidental overlaps.

---

## Phase 3: Spawn Work Partitions (Parallel, Batched)

Work partitions run via the Task tool. To avoid "prompt too long" errors, use **batched spawning** and **file-reference prompts**.

Each partition receives:
1. A **file path** to the Context Document (NOT the content embedded in the prompt)
2. Their **assigned block range**
3. **Specific instructions**

### ⚠️ CRITICAL: File-Reference Pattern (Prevents "Prompt Too Long")

**NEVER embed the full Context Document in Task prompts.** Instead:

1. Save the Context Document to a file: `context-document.md`
2. In the Task prompt, tell the sub-agent to **read the file**:

```
❌ WRONG (causes "prompt too long"):
  ## Context Document
  [PASTE 50K+ TOKENS OF CONTEXT HERE]

✅ CORRECT (sub-agent reads file itself):
  ## Context Document
  Read the file: /path/to/superdoc-redlines/context-document.md
```

This keeps each Task prompt under ~2K tokens. The sub-agent uses its own context window to read the file.

### Work Partition Prompt Template

```markdown
You are a contract review work partition.

## Your Assignment
- **Block Range**: b[START] to b[END]
- **Section**: [SECTION NAME]
- **Output File**: edits-[section].md

## Context Document
Read the context document from file:
  /path/to/superdoc-redlines/context-document.md

## Review Instructions
[USER_INSTRUCTIONS — keep to 1-2 sentences]

## Procedure
1. Read the Context Document file first.

2. Read your assigned chunks:
   ```bash
   cd /path/to/superdoc-redlines
   node superdoc-redline.mjs read --input contract.docx --chunk [N] --max-tokens 10000
   ```

3. For each block, assess amendments based on Context Document.

4. Draft EXACT replacement text (not vague directions).

5. Check "Items Requiring DELETE" - if any are in your range, create DELETE edits.

6. Check "Compound Defined Terms" - change these in your range.

7. Create edits file in **markdown format** (recommended for resilience).

8. **SELF-VALIDATE** your edits before returning:
   ```bash
   node superdoc-redline.mjs validate --input contract.docx --edits edits-[section].md
   ```
   If validation fails, fix the issues and re-validate. Only return when validation passes.

9. Before finalizing, verify:
   - [ ] All DELETEs in my range created
   - [ ] All compound terms in my range changed
   - [ ] All term usages in my range updated
   - [ ] Validation passed (step 8)

## Output
Report: edit count, deletions made, compound terms changed, validation result, any issues.
```

### Per-Partition Self-Validation

**Each partition validates its own edits before returning.** This eliminates the re-validation round-trip:

```
Without self-validation:                With self-validation:
  Partition A → edits-a.md                Partition A → validate → fix → edits-a.md ✓
  Partition B → edits-b.md                Partition B → validate → fix → edits-b.md ✓
  Merge → Validate → ERRORS!              Merge → Validate → CLEAN (formality)
  Fix → Re-validate → ...                 Apply immediately
```

**What self-validation catches:**
- Missing `newText` fields
- Invalid block IDs (typos, out-of-range)
- Truncated content
- Wrong field names

**What it can't catch** (still needs merge-level validation):
- Duplicate block IDs across partitions (detected by `-c error` merge)
- Cross-partition consistency issues

### Execution in Claude Code (Batched Spawning)

**Do NOT spawn all agents at once.** Each Task() call adds to the orchestrator's context. Spawn in **batches of 3-4** to stay within context limits:

```
Batch 1 (spawn simultaneously):
  Task: Partition 1 (b001-b200)  → edits-part1.md (self-validated)
  Task: Partition 2 (b201-b400)  → edits-part2.md (self-validated)
  Task: Partition 3 (b401-b600)  → edits-part3.md (self-validated)
  → Wait for batch 1 to complete

Batch 2 (spawn simultaneously):
  Task: Partition 4 (b601-b800)  → edits-part4.md (self-validated)
  Task: Partition 5 (b801-b1000) → edits-part5.md (self-validated)
  Task: Partition 6 (b1001-b1200)→ edits-part6.md (self-validated)
  → Wait for batch 2 to complete

Batch 3 (if needed):
  Task: Partition 7 (b1201-b1337)→ edits-part7.md (self-validated)
  → Wait for batch 3 to complete
```

**Why batching?** Each Task's prompt + result accumulates in the orchestrator's context. With file-reference prompts (~2K each) and compact results, batches of 3-4 keep the orchestrator comfortably within limits.

Wait for all batches to complete, then merge.

**Empty Edit Files Are Valid:** If a work partition's block range contains no content requiring changes, an empty edit file is acceptable.

---

## Phase 4: Merge & Apply

Since each partition has **already self-validated**, the merge step is streamlined.

### Step 4.1: Collect Edit Files

```bash
ls edits-*.md
```

### Step 4.2: Merge

```bash
node superdoc-redline.mjs merge \
  edits-part1.md edits-part2.md edits-part3.md \
  edits-part4.md edits-part5.md edits-part6.md edits-part7.md \
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
# Final validation (should be clean since partitions self-validated)
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

## Phase 5: Parallel Post-Apply Verification

After applying edits, spawn **parallel verification agents** to check for residual terms that should have been changed. Each agent checks a different category.

### Verification Agent Prompt Template

```markdown
You are a post-apply verification agent. Check for residual terms in one category.

## Assignment
- Category: [CATEGORY_NAME]
- Search Terms: [LIST OF TERMS TO CHECK]
- IR File: contract-ir.json (original)
- Edits File: merged-edits.json

## Procedure
1. For each search term, count occurrences in the original IR:
   ```bash
   cd /path/to/superdoc-redlines
   node superdoc-redline.mjs find-block --input contract-ir.json --text "[TERM]" --limit all
   ```

2. Count how many of those blocks have edits in merged-edits.json:
   ```bash
   grep -c "[TERM]" merged-edits.json
   ```

3. Report coverage: blocks found vs blocks with edits.

4. Save to: verification-[category].md

## Output Format
| Term | Occurrences | Edits | Coverage | Missed Blocks |
|------|------------|-------|----------|---------------|
| VAT  | 12         | 12    | 100%     | none          |
| HMRC | 5          | 4     | 80%      | b920          |
```

### Spawn Verification Agents

```
Spawn simultaneously:
  Verify Agent A: Jurisdiction terms (governing law, court, jurisdiction)
  Verify Agent B: Statute references (Acts, regulations, statutory instruments)
  Verify Agent C: Entity/regulatory terms (Companies House, HMRC, etc.)
  Verify Agent D: Defined terms coverage (all terms from Context Document)
```

**Result:** Comprehensive coverage check in parallel. If any agent reports <100% coverage on critical terms, create supplementary edits and re-apply.

---

## Orchestrator Checklist

```markdown
### Phase 1: Discovery (Batched Parallel)
- [ ] Get stats, extract IR
- [ ] Save review instructions to context-document.md (start the file)
- [ ] Batch 1: Spawn pre-scan agents (3-4 agents) → wait → collect prescan-*.md
- [ ] Batch 2: Spawn discovery agents (2-4 agents) → wait → collect findings-*.md
- [ ] Merge findings into master context-document.md
- [ ] Identify all DELETEs and assign to partitions

### Phase 2: Decomposition (6-8 Partitions)
- [ ] Define block ranges (100-200 blocks per partition, non-overlapping)
- [ ] Save partition plan to context-document.md
- [ ] Verify context-document.md is complete (sub-agents will read this file)

### Phase 3: Execute (Batched Parallel)
- [ ] Batch 3: Spawn partitions 1-3 via Task (file-reference prompts) → wait
- [ ] Batch 4: Spawn partitions 4-6 via Task → wait
- [ ] Batch 5: Spawn partition 7 (if needed) → wait
- [ ] Each self-validates before returning

### Phase 4: Merge & Apply
- [ ] Collect all self-validated edit files
- [ ] Merge all edits with -c error
- [ ] Pre-apply verification
- [ ] Final validate (should be clean)
- [ ] Apply
- [ ] Recompress output file

### Phase 5: Verification (Batched Parallel)
- [ ] Batch 6: Spawn verification agents (3-4 agents) → wait
- [ ] Review coverage reports
- [ ] Create supplementary edits if coverage < 100% on critical terms
- [ ] Re-apply if needed
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
> Multi-agent review can fail with "Prompt is too long" when too many Task() calls accumulate in the orchestrator's context. This is the most common failure mode.

### Root Cause

Every `Task()` call adds to the orchestrator's context:
- The **prompt text** you send to the sub-agent
- The **result text** returned by the sub-agent

If you embed the Context Document (20K-50K tokens) in each of 7 Task prompts, that's 140K-350K tokens of prompt text alone — exceeding the orchestrator's context window.

### Prevention Strategies (Ordered by Priority)

**1. File-Reference Pattern (MANDATORY)**

Never embed the Context Document in Task prompts. Save it to a file and tell the sub-agent to read it:

```
## Context Document
Read: /path/to/superdoc-redlines/context-document.md
```

This reduces each Task prompt from ~30K tokens to ~2K tokens.

**2. Batched Spawning (MANDATORY)**

Spawn agents in batches of 3-4, not all at once:
- Batch 1: Pre-scan agents (3-4 agents) → wait → collect results
- Batch 2: Discovery agents (2-3 agents) → wait → merge findings
- Batch 3: Amendment partitions 1-3 → wait → collect
- Batch 4: Amendment partitions 4-6 → wait → collect
- Batch 5: Amendment partition 7 + verification → wait → collect

**3. Compact Sub-Agent Results**

Tell sub-agents to save detailed results to files and return only a brief summary:
```
## Output
Save edits to: edits-part1.md
Return ONLY a brief summary: "Created X edits (Y replacements, Z deletions). Validation: passed."
```

**4. For Documents >100K Tokens**

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

With parallel agents, token budget is distributed across agents rather than consumed by one orchestrator:

| Phase | Orchestrator Tokens | Per-Agent Tokens | Total Agents |
|-------|-------------------|-----------------|--------------|
| Pre-scan | 5K (dispatch) | ~10K each | 3-4 search agents |
| Discovery | 15K (merge findings) | ~30K each | 2-4 discovery agents |
| Decomposition | 10K (planning) | — | — |
| Amendment | 5K (dispatch) | ~40K each | 6-8 partition agents |
| Merge + Apply | 20K | — | — |
| Verification | 5K (dispatch) | ~15K each | 3-4 verify agents |

**Key insight:** Parallel agents each have their own context window. The orchestrator only needs to hold findings/summaries, not all raw chunk content. This dramatically reduces orchestrator context pressure.

### Discovery Optimization

**With parallel pre-scan** (recommended for all multi-agent runs):
- Pre-scan agents search IR file in parallel (~10K tokens each)
- Discovery agents read chunks in parallel (~30K tokens each)
- Orchestrator merges findings (~15K tokens)
- **Orchestrator token usage:** 20-30% of budget (vs 60-75% for sequential)

**Without parallel pre-scan** (fallback):
- Use `find-block --regex "pattern1|pattern2|pattern3"` instead of reading all chunks
- Read only 2-3 representative chunks per section
- **Orchestrator token usage:** 25-35% of budget

### Edit Creation Optimization

- Create partition edit files in markdown format
- Use `parse-edits` to convert (faster than JSON authoring)
- Each partition agent self-validates (catches errors without orchestrator round-trip)
- **100-200 blocks per partition** keeps each agent well within context limits

### Signs You Should Add More Agents

- Any single agent using >70% of its context
- Partition agents skipping blocks due to context pressure
- Discovery agents unable to read all assigned chunks
- "Prompt too long" errors in any agent

**Solution:** Split the overloaded agent's range into two smaller ranges and add another agent.

---

## Reference

- **Core methodology:** [CONTRACT-REVIEW-SKILL.md](./CONTRACT-REVIEW-SKILL.md)
- **Edit format:** See "Edit File Format Reference" in CONTRACT-REVIEW-SKILL.md
- **Tool documentation:** [SKILL.md](../SKILL.md) and [README.md](../README.md)

---

*Last updated: 7 February 2026*
