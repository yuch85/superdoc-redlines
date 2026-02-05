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

### Assignment Strategies

**Section-Based (Recommended):** Assign contiguous block ranges based on document structure.

**Topic-Based:** Assign specific amendment categories across the document (e.g., "only tax provisions").

### Example Assignments

```markdown
### Agent A: Definitions (b001-b300)
- Output: edits-definitions.json

### Agent B: Core Provisions (b301-b600)  
- Output: edits-provisions.json

### Agent C: Warranties & Schedules (b601-b900)
- Output: edits-warranties.json
```

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

### Spawning in Parallel

```javascript
Promise.all([
  Task({ prompt: agentAPrompt, description: "Definitions" }),
  Task({ prompt: agentBPrompt, description: "Provisions" }),
  Task({ prompt: agentCPrompt, description: "Warranties" })
]);
```

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

## Performance Tips

- Spawn ALL sub-agents simultaneously (parallel, not sequential)
- Use 10K token chunks for thorough review
- Markdown format for large edit sets (more reliable than JSON)

---

## Session Learnings

### 4 February 2026 - Asset Purchase Agreement

**Key insight:** The single-agent approach worked well for this 143K token document. Sub-agents would help for documents >200K tokens or when multiple reviewers need to work in parallel.

**Shared learnings** (edit format, block ID confusion, etc.) documented in CONTRACT-REVIEW-SKILL.md.

---

## Reference

- **Core methodology:** CONTRACT-REVIEW-SKILL.md
- **Edit format:** See "Edit File Format Reference" in CONTRACT-REVIEW-SKILL.md
- **Jurisdiction mappings:** Internal reference (not published): `tests_and_others/reference/uk-to-singapore.md`

---

*Last updated: 4 February 2026*
