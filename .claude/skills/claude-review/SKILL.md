---
name: claude-review
description: Agentic contract review using superdoc-redlines. Spawns parallel sub-agents for comprehensive document review with tracked changes.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
---

# /claude-review

Agentic contract review skill that uses the superdoc-redlines library to review and amend legal documents with tracked changes. For large documents (>50K tokens), spawns parallel sub-agents for comprehensive coverage.

## Usage

```
/claude-review [--single-agent|--multi-agent] <document> <instructions>
```

**Arguments:**
- `--single-agent` (optional) - Force single-agent workflow regardless of document size
- `--multi-agent` (optional) - Force multi-agent workflow regardless of document size
- `<document>` - Path to the DOCX file to review
- `<instructions>` - Review instructions (e.g., "Convert from UK to Singapore jurisdiction")

**Examples:**
```
/claude-review contract.docx Convert from UK to Singapore law
/claude-review --multi-agent contract.docx Convert from UK to Singapore law
/claude-review --single-agent large-contract.docx Review warranties only
/claude-review ./contracts/bta.docx Review warranties and update statutory references
/claude-review "Business Transfer Agreement.docx" Adapt for Singapore jurisdiction, update all UK statutes
```

## How It Works

This skill reads `$ARGUMENTS` for the document path and instructions.

### Argument Parsing

Parse arguments as follows:
1. Check for optional workflow flags: `--single-agent` or `--multi-agent` (if present, remove from arguments)
2. First remaining argument: document path (may be quoted if contains spaces)
3. Remaining arguments: review instructions (joined as a single string)

If arguments are missing, prompt the user for:
1. Document path
2. Review instructions

**Workflow Override:**
- If user specifies `--single-agent` or `--multi-agent`, that workflow MUST be used
- User-specified workflow overrides any automatic selection based on document size
- If no workflow flag is provided, use automatic selection based on document size

### Workflow Selection

**Priority 1 - User Override (if specified):**
- If user provides `--single-agent` flag: Use single-agent workflow
- If user provides `--multi-agent` flag: Use multi-agent workflow

**Priority 2 - Automatic Selection (if no flag):**
Based on document size, choose the appropriate workflow:

| Document Size | Workflow | Reason |
|---------------|----------|--------|
| < 50K tokens | Single-agent | Direct review per CONTRACT-REVIEW-SKILL.md |
| >= 50K tokens | Multi-agent | Orchestrator + sub-agents per CONTRACT-REVIEW-AGENTIC-SKILL.md |

**CRITICAL: User-specified workflow flags override automatic selection.**

## ⚠️ Context Budget Rules (Prevents "Prompt Too Long")

When spawning sub-agents via Task():
1. **NEVER embed** the Context Document in Task prompts — save to `context-document.md`, tell agent to read the file
2. **Spawn in batches** of 3-4 agents, wait for each batch to complete before the next
3. **Require compact results** — agents save details to files, return only 1-line summaries
4. **Budget**: each Task prompt should be ~2K tokens max (assignment + file paths + instructions)

See CONTRACT-REVIEW-AGENTIC-SKILL.md "Context Management for Large Documents" for detailed guidance.

## Step-by-Step Procedure

### Step 1: Validate Document

```bash
cd /home/tyc/ross-ide-contract/superdoc-redlines
node superdoc-redline.mjs read --input "<document>" --stats-only
```

Verify the document exists and get statistics:
- `blockCount` - Number of blocks
- `estimatedTokens` - Token estimate
- `recommendedChunks` - Suggested chunk count

### Step 2: Extract Document Structure

```bash
node superdoc-redline.mjs extract --input "<document>" --output "<document>-ir.json"
```

This creates the block ID mapping needed for edits.

### Step 3: Choose Workflow

**CRITICAL: If user specified --single-agent or --multi-agent flag, use that workflow regardless of document size.**

**Otherwise, use automatic selection:**

**If estimatedTokens < 50,000:** Use single-agent workflow
- Follow CONTRACT-REVIEW-SKILL.md methodology
- Two-pass review (Discovery + Amendment)
- Output: `<document>-edits.json`

**If estimatedTokens >= 50,000:** Use multi-agent workflow
- Follow CONTRACT-REVIEW-AGENTIC-SKILL.md methodology
- Orchestrator performs discovery, spawns sub-agents
- Sub-agents work in parallel on assigned sections
- Merge results into `merged-edits.json`

### Step 4: Parallel Discovery Pass (Multi-Agent, Batched)

For multi-agent workflow, discovery uses **batched parallel agents**. Spawn in batches of 3-4 to avoid "prompt too long" errors.

> **⚠️ CRITICAL: File-Reference Pattern**
> 
> NEVER embed the Context Document in Task prompts. Save it to `context-document.md` and tell sub-agents to read the file. This keeps each Task prompt under ~2K tokens.

#### Step 4a: Parallel Pre-Scan (Batch 1)
Spawn search agents simultaneously to build a term location map:

```
Batch 1 (spawn 3-4 simultaneously):
  Task: Pre-scan A - find-block for regulatory terms → prescan-regulatory.md
  Task: Pre-scan B - find-block for jurisdiction terms → prescan-jurisdiction.md
  Task: Pre-scan C - find-block for statute terms → prescan-statutes.md
  Task: Pre-scan D - find-block for entity terms → prescan-entities.md
→ Wait for batch to complete
```

#### Step 4b: Parallel Discovery Agents (Batch 2)
Spawn discovery agents to read chunks in parallel:

```
Batch 2 (spawn 2-4 simultaneously):
  Task: Discovery 1 - Read chunks 0-4 → findings-1.md
  Task: Discovery 2 - Read chunks 5-9 → findings-2.md
  Task: Discovery 3 - Read chunks 10+ → findings-3.md
→ Wait for batch to complete
```

Scale discovery agents based on chunk count (2 agents for 5-8 chunks, 3 for 9-14, 4+ for 15+).

#### Step 4c: Merge Findings
Orchestrator reads all `prescan-*.md` and `findings-*.md` files, deduplicates, and builds the master **`context-document.md`** file with:
- Defined Terms Registry (all terms and their usage locations)
- Provisions to change (based on user instructions)
- Cross-reference map
- Section map with block ranges
- Partition assignments (6-8 partitions, 100-200 blocks each)

**This file is what sub-agents will read** — it must be complete before spawning amendment agents.

#### Single-Agent Discovery
For single-agent workflow, read chunks sequentially per CONTRACT-REVIEW-SKILL.md.

### Step 5: Parallel Amendment Pass (Batched)

#### Single-Agent Path
Process each chunk with full Context Document, drafting exact amendments.

#### Multi-Agent Path
1. Plan **6-8 partition assignments** (100-200 blocks each, non-overlapping)
2. Save partition plan to `context-document.md`
3. Spawn partitions in **batches of 3-4** (file-reference prompts, ~2K tokens each):

```
Batch 3 (spawn 3 simultaneously):
  Task: Partition 1 (b001-b200)  → edits-part1.md
    Prompt: "Read context-document.md, review b001-b200, output edits-part1.md, self-validate."
  Task: Partition 2 (b201-b400)  → edits-part2.md
  Task: Partition 3 (b401-b600)  → edits-part3.md
→ Wait for batch to complete

Batch 4 (spawn 3 simultaneously):
  Task: Partition 4 (b601-b800)  → edits-part4.md
  Task: Partition 5 (b801-b1000) → edits-part5.md
  Task: Partition 6 (b1001-b1200)→ edits-part6.md
→ Wait for batch to complete

Batch 5 (if needed):
  Task: Partition 7 (b1201-b1337)→ edits-part7.md
→ Wait for batch to complete
```

Each partition agent **self-validates** its edits before returning (runs `validate` command internally).

4. Merge all edit files:

```bash
node superdoc-redline.mjs merge \
  edits-part1.md edits-part2.md edits-part3.md \
  edits-part4.md edits-part5.md edits-part6.md edits-part7.md \
  -o merged-edits.json \
  -c error \
  -v "<document>"
```

### Step 6: Validate and Apply

```bash
# Final validate (should be clean since partitions self-validated)
node superdoc-redline.mjs validate --input "<document>" --edits "<edits-file>"

# Apply with track changes
node superdoc-redline.mjs apply \
  --input "<document>" \
  --output "<document>-amended.docx" \
  --edits "<edits-file>" \
  --author-name "AI Legal Counsel"
```

### Step 7: Parallel Post-Apply Verification (Batch 6)

Spawn verification agents in one batch:

```
Batch 6 (spawn 3-4 simultaneously):
  Task: Verify A - Check jurisdiction terms coverage → verification-jurisdiction.md
  Task: Verify B - Check statute references coverage → verification-statutes.md
  Task: Verify C - Check entity/regulatory terms → verification-entities.md
  Task: Verify D - Check defined terms coverage → verification-terms.md
→ Wait for batch to complete
```

Each agent compares term occurrences in original IR against edits applied. If coverage <100% on critical terms, create supplementary edits and re-apply.

### Step 8: Report Results

Report to user:
- Total edits applied
- Breakdown by category (replacements, deletions, insertions, comments)
- Coverage verification results (from parallel verification agents)
- Output file path
- Any issues or items needing human review

## Reference Documentation

The detailed methodology is documented in:

- **Single-agent workflow:** `superdoc-redlines/CONTRACT-REVIEW-SKILL.md`
- **Multi-agent workflow:** `superdoc-redlines/CONTRACT-REVIEW-AGENTIC-SKILL.md`
- **Library reference:** `superdoc-redlines/README.md`
- **Quick skill reference:** `superdoc-redlines/SKILL.md`

## Sub-Agent Prompt Templates

### Amendment Partition Agent

When spawning amendment sub-agents for multi-agent workflow, use this template.

**⚠️ CRITICAL:** Do NOT embed the Context Document in the prompt. Reference the file path instead. This prevents "prompt too long" errors.

```markdown
You are a contract review sub-agent. Review your assigned section, produce an edits file, and self-validate.

## Assignment
- Block Range: b[START] to b[END]
- Section: [SECTION_NAME]
- Output: edits-[section].md

## Review Instructions
[USER_INSTRUCTIONS — 1-2 sentences only]

## Context Document
Read the full context from file: /home/tyc/ross-ide-contract/superdoc-redlines/context-document.md

## Procedure
1. Read the context document file first.

2. Read your assigned chunks:
   ```bash
   cd /home/tyc/ross-ide-contract/superdoc-redlines
   node superdoc-redline.mjs read --input "[DOCUMENT]" --chunk [N] --max-tokens 10000
   ```

3. For each block in your range, assess amendments needed based on:
   - The review instructions
   - Defined terms changes from Context Document
   - Provisions requiring deletion or replacement

4. Draft EXACT replacement text (not vague directions)

5. Create edits file in markdown format (more resilient than JSON)

6. **SELF-VALIDATE** before returning:
   ```bash
   node superdoc-redline.mjs validate --input "[DOCUMENT]" --edits edits-[section].md
   ```
   If validation fails, fix the issues and re-validate. Only return when validation passes.

7. Save edits to file. Return ONLY a brief summary:
   "Created X edits (Y replacements, Z deletions). Validation: passed/failed. Issues: none."

## Rules
- ONLY edit blocks in your assigned range
- Draft exact replacement text
- Use diff: true for surgical edits, diff: false for rewrites
- Must pass validation before returning
- Return a SHORT summary, NOT the full edit content
```

### Pre-Scan Search Agent

```markdown
You are a pre-scan search agent. Search the IR file for terms in your assigned category.

## Assignment
- Category: [CATEGORY_NAME]
- Search Patterns: [REGEX_PATTERNS]
- IR File: [DOCUMENT]-ir.json
- Output: prescan-[category].md

## Procedure
1. Run find-block searches:
   ```bash
   cd /home/tyc/ross-ide-contract/superdoc-redlines
   node superdoc-redline.mjs find-block --input "[DOCUMENT]-ir.json" --regex "[PATTERN]" --limit all
   ```

2. Save all matches with block IDs and context to: prescan-[category].md

3. Return ONLY: "Found X matches across Y blocks. Saved to prescan-[category].md"
```

### Discovery Agent

```markdown
You are a discovery agent. Read your assigned chunks and extract findings.

## Assignment
- Chunks: [START] to [END]
- Output: findings-[N].md

## Procedure
1. Read each assigned chunk:
   ```bash
   cd /home/tyc/ross-ide-contract/superdoc-redlines
   node superdoc-redline.mjs read --input "[DOCUMENT]" --chunk [N] --max-tokens 10000
   ```

2. Extract: defined terms, term usages, provisions to change/delete, cross-references.

3. Save to: findings-[N].md

4. Return ONLY: "Processed chunks [START]-[END]. Found X terms, Y provisions. Saved to findings-[N].md"
```

### Verification Agent

```markdown
You are a verification agent. Check coverage for your assigned term category.

## Assignment
- Category: [CATEGORY_NAME]
- Terms to Check: [TERM_LIST]
- Edits File: merged-edits.json
- Output: verification-[category].md

## Procedure
1. For each term, count occurrences in original IR:
   ```bash
   cd /home/tyc/ross-ide-contract/superdoc-redlines
   node superdoc-redline.mjs find-block --input "[DOCUMENT]-ir.json" --text "[TERM]" --limit all
   ```

2. Count matching edits in merged-edits.json.

3. Report coverage per term. Flag any <100% coverage on critical terms.

4. Save to: verification-[category].md

5. Return ONLY: "Category [NAME]: X/Y terms at 100% coverage. Z gaps found. Saved to verification-[category].md"
```

## Working Directory

All commands should be run from:
```
/home/tyc/ross-ide-contract/superdoc-redlines
```

## Output Files

| File | Purpose | Phase |
|------|---------|-------|
| `<document>-ir.json` | Extracted document structure with block IDs | Setup |
| `prescan-*.md` | Pre-scan search results by category | Discovery |
| `findings-*.md` | Discovery agent findings by chunk range | Discovery |
| `<document>-context.md` | Master Context Document (merged findings) | Discovery |
| `edits-part*.md` | Edit files from each partition agent | Amendment |
| `merged-edits.json` | Combined edits (multi-agent only) | Merge |
| `verification-*.md` | Coverage reports by term category | Verification |
| `<document>-amended.docx` | Final output with tracked changes | Apply |

## Error Handling

- If document doesn't exist: Report error, ask for correct path
- If sub-agent fails: Re-spawn for remaining blocks or process directly
- If merge conflicts: Review and resolve, re-merge with appropriate strategy
- If validation fails: Identify and fix problematic edits, re-validate
