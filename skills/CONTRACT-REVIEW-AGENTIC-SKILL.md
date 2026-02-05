---
name: Contract Review Agentic Skill
description: Orchestrator-subagent methodology for parallel contract review using superdoc-redlines
---

# Contract Review Agentic Skill

## Overview

This skill enables **parallel contract review** using an orchestrator-subagent architecture. The orchestrator coordinates multiple sub-agents working on different sections simultaneously, then merges their edits.

**Prerequisites:** Familiarity with **CONTRACT-REVIEW-SKILL.md** (core methodology, edit formats, two-pass workflow).

> **⚠️ Examples Are Illustrative Only**
> 
> Examples use UK → Singapore conversion. The architecture applies to any contract review task.

### When to Use

| Document Size | Approach |
|---------------|----------|
| < 50K tokens | Single-agent (CONTRACT-REVIEW-SKILL.md) |
| 50K - 150K tokens | 2-4 sub-agents |
| > 150K tokens | 4-8 sub-agents |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR AGENT                           │
│  - Discovery Pass (read all chunks, build Context Document)         │
│  - Work decomposition (assign block ranges to sub-agents)          │
│  - Merge results and validate                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
    ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
    │ SUB-AGENT A │       │ SUB-AGENT B │       │ SUB-AGENT C │
    │ b001-b300   │       │ b301-b600   │       │ b601-b900   │
    └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
           │                     │                     │
           ▼                     ▼                     ▼
    edits-a.json          edits-b.json          edits-c.json
           │                     │                     │
           └─────────────────────┼─────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │    MERGE & VALIDATE     │
                    │    → APPLY              │
                    └─────────────────────────┘
```

---

## Phase 1: Orchestrator Discovery

The orchestrator completes a **full discovery pass** before spawning sub-agents.

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

See CONTRACT-REVIEW-SKILL.md for Context Document template. For agentic workflow, add:

```markdown
## Sub-Agent Assignments
| Agent | Block Range | Section | Key Tasks |
|-------|-------------|---------|-----------|
| A | b001-b300 | Definitions | Term changes, deletions |
| B | b301-b600 | Provisions | Tax provisions |
| C | b601-b900 | Warranties | Employment, general |

## Items Requiring DELETE (with assigned agent)
| Term | Block | Assigned Agent |
|------|-------|----------------|
| TULRCA | b257 | Agent A |
| TUPE | b258 | Agent A |
```

---

## Phase 2: Work Decomposition

### Block Range Assignment Best Practices

> **⚠️ Critical Lesson Learned (5 February 2026)**
>
> In a UK→Singapore asset purchase adaptation, the "boilerplate" agent was assigned blocks b1231-b1317, but the governing law clauses it needed to edit were actually at b651, b658, b680, b681. The sequential block assignment didn't account for where clause types were actually located.
>
> **Key insight:** Block numbers are sequential through the document, but clause types are not necessarily sequential. Definitions may reference governing law; warranties may contain jurisdiction-specific terms; schedules may duplicate main document provisions.

### Discovery-First Assignment (Recommended)

Before assigning ranges, the orchestrator MUST map clause types to actual block locations:

```markdown
## Clause Location Map (Built During Discovery)

| Clause Type | Block IDs | Section Name |
|-------------|-----------|--------------|
| Definitions | b001-b300 | Clause 1 |
| Governing Law | b651, b658, b680, b681 | Clause 24 |
| Jurisdiction | b682-b695 | Clause 25 |
| TUPE/Employment | b450-b480, b720-b750 | Clauses 12, Schedule 4 |
| Tax Provisions | b380-b420, b850-b900 | Clauses 9, Schedule 7 |
| Boilerplate | b1100-b1200 | Clauses 26-30 |
```

Then assign agents by **clause type grouping**, not sequential ranges:

```markdown
## Agent Assignments (By Clause Type)

### Agent A: Definitions & Terms
- Blocks: b001-b300
- Also: Any blocks referencing defined terms
- Output: edits-definitions.json

### Agent B: Jurisdiction-Sensitive Clauses
- Blocks: b651, b658, b680-b695, b1100-b1150
- Includes: Governing law, jurisdiction, service of process
- Output: edits-jurisdiction.json

### Agent C: Employment & TUPE
- Blocks: b450-b480, b720-b750
- Includes: TUPE references wherever they appear
- Output: edits-employment.json
```

### Assignment Strategies

**Clause-Type Based (Recommended):** Group blocks by legal clause type, even if non-contiguous. The orchestrator must identify all locations of each clause type during discovery.

**Section-Based:** Assign contiguous block ranges based on document structure. Simpler but risks missing related clauses in different sections.

**Topic-Based:** Assign specific amendment categories across the document (e.g., "only tax provisions"). Requires thorough discovery to identify all relevant blocks.

### Include Overlap Buffer Zones

When clause boundaries are ambiguous, include buffer zones:

```markdown
### Agent A: Definitions (b001-b320)
- Core range: b001-b300
- Buffer: b301-b320 (may contain late definitions)

### Agent B: Core Provisions (b290-b620)
- Buffer: b290-b310 (overlap with definitions)
- Core range: b311-b600
- Buffer: b601-b620 (may contain provision spillover)
```

Use `-c first` or `-c last` conflict strategy during merge to handle overlaps.

### Example Assignments (Improved)

```markdown
### Agent A: Definitions (b001-b300)
- **Also check**: b651 (may contain "Business Day" jurisdiction refs)
- Output: edits-definitions.json

### Agent B: Core Provisions (b301-b600)
- Output: edits-provisions.json

### Agent C: Warranties & Schedules (b601-b900)
- **Also check**: Governing law at b651, b658 if not assigned elsewhere
- Output: edits-warranties.json

### Agent D: Boilerplate & Jurisdiction (b901-b1200)
- **Critical blocks**: b651, b658, b680, b681 (governing law/jurisdiction)
- Output: edits-boilerplate.json
```

### Anti-Pattern: Sequential-Only Assignment

❌ **Don't do this:**
```markdown
Agent A: b001-b400
Agent B: b401-b800
Agent C: b801-b1200
```

This ignores clause type distribution and will miss edits when:
- Governing law appears in multiple places
- Defined terms are referenced throughout
- Schedules repeat main document language

---

## Phase 3: Spawn Sub-Agents

Each sub-agent receives:
1. The **Context Document** (global context)
2. Their **assigned block range**
3. **Specific instructions**

### Sub-Agent Prompt Template

```markdown
You are a contract review sub-agent.

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

### Spawning Sub-Agents

> **⚠️ Claude Code Note (February 2026)**
>
> Claude Code does not support parallel sub-agent spawning via `Promise.all([Task(...)])`.
> Instead, simulate the multi-agent workflow by creating separate edit files sequentially:
>
> 1. Work on Agent A's block range → create `edits-definitions.json`
> 2. Work on Agent B's block range → create `edits-provisions.json`
> 3. Work on Agent C's block range → create `edits-warranties.json`
> 4. Merge all files together
>
> The organizational value of decomposition (separating by clause type) remains beneficial even without actual parallelization.

**For environments with parallel task support:**
```javascript
Promise.all([
  Task({ prompt: agentAPrompt, description: "Definitions" }),
  Task({ prompt: agentBPrompt, description: "Provisions" }),
  Task({ prompt: agentCPrompt, description: "Warranties" })
]);
```

**Empty Edit Files Are Valid:**
If a sub-agent's block range contains no UK-specific content requiring changes, an empty edit file is acceptable. Core provisions (sale, consideration, completion) often use defined terms without directly citing statutes, so changes at the definition level handle the conversion.

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
- `error` - **Recommended.** Fail if any conflicts. Forces you to review overlapping edits.
- `first` - Keep first edit (by file order)
- `last` - Keep last edit (by file order)
- `combine` - Merge comments; use `first` for other operations. **Caution:** May silently pick truncated edits.

> **⚠️ Why `-c error` is now recommended:**
> Previous guidance recommended `-c combine`, but investigation found this can silently keep truncated or corrupt edits when two agents edit the same block. Use `-c error` to detect conflicts, then resolve manually.

### Step 4.3: Pre-Apply Verification

- [ ] Every DELETE in Context Document has an edit
- [ ] Every compound term has an edit
- [ ] No residual terms in newText fields

### Step 4.4: Validate & Apply

```bash
node superdoc-redline.mjs validate --input contract.docx --edits merged-edits.json
node superdoc-redline.mjs apply -i contract.docx -o amended.docx -e merged-edits.json --strict
```

**New apply options:**
- `--strict` - Treat truncation/corruption warnings as errors. Recommended for production.
- `--verbose` - Enable detailed logging for debugging position mapping issues.

The apply command now validates `newText` for:
- Significant truncation (content reduction > 50%)
- Incomplete sentences (ends mid-word)
- JSON truncation patterns (trailing comma, unclosed quote)
- Garbled content patterns (e.g., "4.3S$" suggesting corruption)

### Step 4.5: Recompress Output File

**⚠️ SuperDoc writes uncompressed DOCX files (~6x larger).** See CONTRACT-REVIEW-SKILL.md "Step 5: Recompress Output File" for the recompression script.

---

## Orchestrator Checklist

```markdown
### Phase 1: Discovery
- [ ] Get stats, extract IR
- [ ] Read ALL chunks
- [ ] Build Context Document with sub-agent assignments
- [ ] Identify all DELETEs and assign to agents

### Phase 2: Decomposition
- [ ] Define block ranges (non-overlapping)
- [ ] Prepare sub-agent prompts

### Phase 3: Spawn
- [ ] Launch all sub-agents in parallel
- [ ] Each has Context Document + block range

### Phase 4: Collect
- [ ] Wait for all agents
- [ ] Verify each reported their DELETEs and compound terms

### Phase 5: Merge & Apply
- [ ] Merge all edits
- [ ] Pre-apply verification
- [ ] Validate
- [ ] Apply
- [ ] Recompress output file (SuperDoc writes uncompressed)
- [ ] Post-apply verification
```

---

## Global Constraints

Sub-agents must respect constraints from the Context Document:

1. **Defined Terms Consistency** - Apply changes from "Terms to Change" table
2. **Citation Format** - Use consistent format (e.g., Singapore statutes by year)
3. **Delete-and-Insert** - When deleting, assess if insertion needed
4. **Cross-Reference Preservation** - Don't break clause references

---

## Error Handling

| Issue | Resolution |
|-------|------------|
| Sub-agent timeout | Re-spawn with remaining range, or orchestrator processes directly |
| Merge conflict | Review both edits, use appropriate conflict strategy |
| Validation failure | Fix problematic edits (invalid blockId, etc.), re-validate |

---

## Context Management for Large Documents

> **⚠️ Prompt Too Long Failures**
>
> 15% of multi-agent review iterations failed with "Prompt is too long" during the orchestration phase. This occurs when the Context Document becomes too large.

### Prevention Strategies

**1. Summarize Context Document Before Spawning Sub-Agents**
```markdown
## Condensed Context for Sub-Agents

### Key Term Mappings (for all agents)
| Original | New |
|----------|-----|
| VAT | GST |
| HMRC | IRAS |
| Companies Act 2006 | Companies Act 1967 |

### Agent-Specific Assignments
[Only include blocks relevant to this agent]
```

**2. Limit Sub-Agent Context**
Sub-agents receive only:
- Their assigned block range
- Term mappings relevant to that range
- NOT the full Context Document with all 14 chunks summarized

**3. For Documents >100K Tokens**
Consider running orchestrator and sub-agents as separate sessions to avoid context accumulation.

---

## Performance Tips

- In environments with parallel task support, spawn ALL sub-agents simultaneously
- Use 10K token chunks for thorough review
- Markdown format for large edit sets (more reliable than JSON)
- For very large documents, consider batching sub-agent prompts to avoid context limits

---

## Session Learnings

### 5 February 2026 - Multi-Agent UK→Singapore Adaptation

**Issue discovered:** Sequential block range assignment caused the "boilerplate" agent (assigned b1231-b1317) to miss governing law clauses that were actually located at b651, b658, b680, b681.

**Root cause:** Block ranges were assigned by sequential document position rather than by clause type. Legal documents don't have clause types in sequential order - governing law can appear in definitions, main provisions, and schedules.

**Solution implemented:** Added "Block Range Assignment Best Practices" section to this document with:
1. Discovery-first mapping of clause types to block locations
2. Clause-type based assignment (not sequential)
3. Overlap buffer zones for ambiguous boundaries

**Also fixed in superdoc-redlines library:**
- Added `normalizeEdit()` function for field name normalization
- Added field validation to `validateMergedEdits()`
- Added `--normalize` flag to merge command
- Added `--skip-invalid` flag to apply command
- Added `--quiet-warnings` flag to apply command

### 4 February 2026 - Asset Purchase Agreement

**Key insight:** The single-agent approach worked well for this 143K token document. Sub-agents would help for documents >200K tokens or when multiple reviewers need to work in parallel.

**Shared learnings** (edit format, block ID confusion, etc.) documented in CONTRACT-REVIEW-SKILL.md.

---

## Reference

- **Core methodology:** CONTRACT-REVIEW-SKILL.md
- **Edit format:** See "Edit File Format Reference" in CONTRACT-REVIEW-SKILL.md
- **Jurisdiction mappings:** Internal reference (not published): `tests_and_others/reference/uk-to-singapore.md`

---

*Last updated: 5 February 2026*
