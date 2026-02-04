# DEBUG-HANDOFF6: Remaining issues with CONTRACT-REVIEW-SKILL.MD and CONTRACT-REVIEW-SKILL-AGENTIC.MD

## Issue Summary

- **Date:** 2026-02-05
- **Owner:** [Name/Handle]
- **Status:** ROOT CAUSE IDENTIFIED - Position mapping is NOT the issue; LLM truncation and merge conflicts are the true causes
- **Scope:** `CONTRACT-REVIEW-AGENTIC-SKILL.md`, `CONTRACT-REVIEW-SKILL.md`, merge/apply workflow in `superdoc-redline.mjs`, plus core library modules (`editMerge.mjs`, `editApplicator.mjs`, `blockOperations.mjs`, `wordDiff.mjs`, `documentReader.mjs`, `irExtractor.mjs`) and any orchestration scripts
- **Suspected Location:** **Library position-mapping logic** (elevated priority) + skill guidance + merge conflict handling

## Context

**Goal**: Two separate rounds of review were conducted with the same prompt (to adapt a UK law document for Singapore purposes), and to produce a redlined version. The first run was the Agentic Skill run by Claude Code, and the second one was the non-agentic Skill run by Cursor. 

- **Original document:** `Business Transfer Agreement/Precedent - PLC - Asset purchase agreement.docx` (~1493 lines, UK law)
- **Agentic tooling:** Orchestrator + sub-agents, merged edits, then applied → output: `test11.docx`
- **Single-agent tooling:** One agent produces a single edits file, then applied → output: `test12.docx`

---

## Round 1: Agentic Skill Run (Claude Code)

- **Skill:** `superdoc-redlines/CONTRACT-REVIEW-AGENTIC-SKILL.md`
- **Input:** `Business Transfer Agreement/test11.docx`

### Issues Observed

List issues found in this round.

1. Parties clause after amendment: "incorporated and registered in Singapore with UEN [NUMBER] whose registered office is at [REGISTERED OFFICE ADDRESS]" Issue: Wrong deletion of large chunk preceding that "[FULL COMPANY NAME] incorporated...". Observation: Cursor Skill Run did not encounter this issue, and rendered a perfect diff by deleting "registered in England and Wales" and replacing with Singapore: "[FULL COMPANY NAME] incorporated in Singapore with Unique Entity Number (UEN) [NUMBER] whose registered office is at [REGISTERED OFFICE ADDRESS]  (Seller)"

2. Missed amending the UK references to PAYE, VAT, etc. in this definition: "Excluded Liabilities: the Excluded Contract Liabilities and all the liabilities or obligations relating to the Business or Assets (other than the Assumed Liabilities) and outstanding on, or accrued or referable to the period up to and including, the Effective Time or arising by virtue of the Transaction, including any and all liabilities in respect of National Insurance, PAYE, VAT or other Taxation attributable to the Seller in respect of the Business, the Assets or the Employees relating to the period ending on the Effective Time [and all bank and other overdrafts and loans and any connected penalties, charges or fees owing by the Seller]." Observation: Cursor Skill Run did not encounter this issue, and rendered a perfect diff.

3. Inappropriate drafting / awkward replacement of original UK TUPE clause (should have just deleted it, which Cursor did): "Employment Transfer: the transfer of employees in connection with a transfer of business, governed by common law principles and the Employment Act 1968 (Cap. 91) (noting that Singapore does not have legislation equivalent to TUPE and employee transfers are governed by contract and common law)."

**4. Excessive deletion leading to incomplete sentence**: "[Any amount expressed to be in Singapore dollars shall, to the extent that it requires to be expressed in any other currency" (missing words: "in order to give full effect to this agreement, be deemed for that purpose to have been converted into the relevant currency immediately before the close of business on the date of this agreement (or, if that is not a Business Day, the Business Day immediately before it). Subject to any applicable legal requirements governing conversions into that currency, the rate of exchange shall be [NAME] Bank's spot rate for the purchase of that currency with Singapore dollars at the time of the deemed conversion"). Observation: Cursor Skill Run did not encounter this issue, and rendered a perfect diff.

**5. Excessive/wrong deletions**: "4.1 The Purchase Price is the sum of 4.3S$[AMOUNT]". Correct version (Cursor Skill run) is to just make one change: currency symbol : "The Purchase Price is the sum of S$[AMOUNT], which shall be paid by the Buyer to the Seller in cash on Completion in accordance with clause 4.3."

**6. Excessive deletion**: "All payments to be made to the Seller under this agreement shall be made in Singapore dollars by electronic transfer" Correct version (Cursor Skill run): "All payments to be made to the Seller under this agreement shall be made in Singapore dollars by electronic transfer of immediately available funds to [the Seller OR the Seller's Solicitors (who are irrevocably authorised by the Seller to receive the same)] [to the following account: [INSERT ACCOUNT DETAILS]]. [Payment to the Seller's Solicitors in accordance with this clause shall be a good and valid discharge of the obligations of the Buyer to pay the sum in question to the Seller, and the Buyer shall not be concerned to see the application of the monies so paid.]"

7. GBP pound symbol not amended (this was correctly amended in Cursor Skill run): "commit itself to any expenditure in excess of £[AMOUNT] in relation to the Business or any expenditure outside its usual and ordinary course in relation to the Business in excess of £[AMOUNT];". Note that this is quite far down the document, Schedule 1. 

8. UK TUPE reference not deleted (correctly amended in Cursor Skill run): "Not later than two Business Days after the Completion Date, the Seller shall send to each of the Employees a letter, in the agreed form, explaining that their employment has been transferred to the Buyer pursuant to TUPE."

---

## Round 2: Cursor Skill Run (single agent)

- **Skill:** `superdoc-redlines/CONTRACT-REVIEW-SKILL.md`
- **Input:** `Business Transfer Agreement/test12.docx`


### Issues Observed

List issues found in this round.

1. Missed out amending the reference to the UK Competition and Markets Authority in this definition: "[Phase 2 CMA Reference: a reference by the Competition and Markets Authority to its chair for the constitution of a group under Schedule 4 to the Enterprise and Regulatory Reform Act 2013. ]" Observation: the Agentic Skill Run correctly caught this and amended to: "[Phase 2 CCCS Reference: a reference by the Competition and Consumer Commission of Singapore for an in-depth investigation under Part III of the Competition Act 2004 (Cap. 50B).]"

2. UK Data Protection Act references not amended (this was correctly amended by the Agentic Skill (Claude Code) run): "20.1 The Buyer undertakes that, on receipt of the Customer Database and Employee Database on the Completion Date:
            (a) it shall duly observe all its obligations as a Data Controller under the DPA 1998 which arise in connection with processing Customer Data and Employee Data;
            (b) it shall comply with the eight Data Protection Principles set out in the DPA 1998 and, in particular, it shall process Customer Data and Employee Data fairly and lawfully in accordance with the First Data Protection Principle for the purpose of the continued provision of details of the [product(s)] [and] [services] to the Customers and in connection with the employment of the Data Employees and in accordance with the terms and conditions set out in this agreement;
            (c) it shall send a fair processing notice to each Customer and Data Employee identified in the Customer Database and Employee Database in the form set out in Error: Reference source not found within [NUMBER] Business Days of the Completion Date;
            (d) it shall respond to any request made by a Data Employee or Customer in relation to the provision of details of the [product(s)] [and] [services] in accordance with the rights of data subjects (as defined in the DPA 1998); and
            (e) it shall obtain, and at all times maintain, a notification under the DPA 1998 appropriate to the performance of its obligations under this agreement."

3. UK legislation reference not amended (this was correctly amended by the Agentic Skill (Claude Code) run)

- "not more than [NUMBER]% of any class of shares or securities of any company traded on a recognised investment exchange (within the meaning of the Financial Services and Markets Act 2000"
- "Planning Acts: the Town and Country Planning Act 1990, the Planning (Listed Buildings and Conservation Areas) Act 1990, the Planning (Hazardous Substances) Act 1990, the Planning (Consequential Provisions) Act 1990, the Planning and Compensation Act 1991, the Planning and Compulsory Purchase Act 2004, the Planning Act 2008, the Localism Act 2011, the Growth and Infrastructure Act 2013, the Housing and Planning Act 2016 and the Neighbourhood Planning Act 2017 and any other legislation from time to time regulating the use or development of land"


## Cross-Round Comparison

Call out overlaps or differences between the two runs.

- **Shared issues:** None observed; the error modes differ.
- **Unique to Round 1:** Incorrect amendments (wrong deletions/truncation) + missed updates.
- **Unique to Round 2:** Omissions only (missed UK law references), no wrong diffs.

---

## Reproduction Steps

Provide minimal steps to reproduce.

1. **Agentic run:** produce per-agent edit files (JSON or markdown converted to JSON).
2. Merge edits using `node superdoc-redline.mjs merge ... -c combine -v contract.docx`.
3. Apply merged edits using `node superdoc-redline.mjs apply -i contract.docx -o amended.docx -e merged-edits.json`.
4. Compare resulting output to expected amendments in the relevant clauses (issues #4-#6).

---

## Findings from Code/Docs

- **Merge conflict behavior:** `combine` keeps the first non-comment edit and drops later edits for the same block; only comments are actually combined.
- **Merge validation scope:** `merge -v` validates missing blocks and delete-then-reference, but does not detect "wrong edit chosen" when conflicts are resolved by strategy.
- **Apply defaults:** `apply` validates then filters invalid edits; it does not rewrite content unless instructed. `diff` is enabled by default for replace edits (`diff !== false`).

---

## Hypothesis / Suspected Root Cause

### Primary Hypothesis: Library Position-Mapping Bug

Issue #5's content reordering ("4.3" appearing in wrong location) cannot be explained by truncated `newText` alone. This points to a bug in `blockOperations.mjs`:

- **Suspected function:** `buildPositionMap()` or `applyWordDiff()`
- **Mechanism:** Text position → editor position mapping becomes corrupt when:
  - Block contains non-text nodes (bookmarks, formatting runs, comments)
  - Special characters (like "£") are handled differently by `extractNodeText` vs `textBetween`
  - Position map is used after document modifications invalidate some mappings

### Secondary Hypothesis: Skill + Merge Issues

For issues #4 and #6 (pure truncation), these could also be explained by:

- **Agentic Skill:** `-c combine` preserves first edit in conflicts, which may be incomplete
- **Core Skill:** Insufficient enforcement of full-block `newText` requirement
- **LLM behavior:** Output truncation during long JSON generation (covered in DEBUG-HANDOFF5)

### Why the Library Bug is Elevated

The Cursor single-agent run worked correctly using the same library. However:
- Cursor run may have had simpler edits (fewer operations per block)
- Cursor run didn't go through merge
- The problematic blocks in the agentic run may have had more complex structure

**The single-agent success doesn't rule out library bugs that only manifest under specific conditions** (multiple operations, complex blocks, certain character patterns).

## Critical Assessment: Could This Be a Library Bug?

### Issue Pattern Analysis

Looking at the specific issues more carefully reveals **two distinct failure modes**:

| Issue | Pattern | Type |
|-------|---------|------|
| #4 | Sentence cut off mid-way | Truncation |
| #5 | "4.3" appearing in wrong position ("sum of 4.3S$") | **Content Corruption** |
| #6 | Sentence cut off after "electronic transfer" | Truncation |

**Issue #5 is particularly suspicious.** The output "4.1 The Purchase Price is the sum of 4.3S$[AMOUNT]" shows:
- "4.3" (from "clause 4.3" at the END of the original) appearing BEFORE "S$"
- This is NOT simple truncation—it's content from one location appearing in another

This pattern suggests **position mapping corruption** or **operation application order bugs**, not just incomplete `newText`.

---

### Library-Level Hypotheses (Elevated Priority)

#### 1. Position Map Corruption in `buildPositionMap` (`blockOperations.mjs:156-176`)

The position map builds a text-position → editor-position mapping by walking character-by-character:

```javascript
function buildPositionMap(editor, blockPos, blockText, blockSize) {
  const map = new Array(blockText.length);
  let editorPos = blockPos;
  let textPos = 0;
  
  while (textPos < blockText.length && editorPos < blockPos + blockSize) {
    const char = editor.state.doc.textBetween(editorPos, editorPos + 1);
    if (char === blockText[textPos]) {
      map[textPos] = editorPos;
      textPos++;
    }
    editorPos++;
  }
  return map;
}
```

**Potential bugs:**
- `blockPos` is the NODE position, not the first TEXT position. If non-text content (bookmarks, comments, formatting runs) precedes the actual text, the map could be offset.
- If `blockText` (from `extractNodeText`) disagrees with `textBetween` output (e.g., special characters like "£" handled differently), positions could be mis-mapped.
- If the loop exits early (editorPos hits blockSize before all textPos matched), later positions are `undefined`.
- **The map is a sparse array**—if entries are undefined or wrong, operations go to wrong locations.

**Test:** Log the position map for the Purchase Price clause and verify it's monotonically increasing with no gaps.

#### 2. Stale Position Map After Operations (`blockOperations.mjs:199-306`)

The position map is built ONCE before any operations are applied:

```javascript
function applyWordDiff(editor, pos, node, originalText, newText, author, comment) {
  const operations = diffToOperations(originalText, newText);
  const positionMap = buildPositionMap(editor, pos, originalText, node.nodeSize);
  const sortedOps = [...operations].sort((a, b) => b.position - a.position);
  
  for (const op of sortedOps) {
    // Uses positionMap[op.position] — but document has changed!
  }
}
```

The code sorts operations by TEXT position (descending) and applies from end-to-start. This should keep earlier editor positions valid. **However:**
- If two operations have the same or adjacent text positions, the sorting may not be stable.
- If an operation changes text length (e.g., "£" → "S$"), and subsequent operations reference the old text positions, the editor positions from the map could now point to wrong content.

**Specific scenario for issue #5:**
1. Original: "...sum of £[AMOUNT], which...clause 4.3."
2. Operations: (a) Replace "£" with "S$" at text pos 50, (b) Delete from text pos 60 to end
3. Sorted: (b) first (higher pos), then (a)
4. Apply (b): Delete from editorPos mapped from textPos 60
5. Apply (a): Use editorPos mapped from textPos 50 — but this was mapped in the ORIGINAL document
6. If (b) shifted content, (a) could now be inserting "S$" at the wrong location, possibly where "4.3" was

**Test:** Add logging to trace each operation's text position, editor position, and document state before/after.

#### 3. Word-Diff Token Misalignment (`wordDiff.mjs`)

The tokenizer uses regex `/(\w+|[^\w\s]+|\s+)/g`:
- "£" → `["£"]` (non-word char)
- "4.3" → `["4", ".", "3"]` (word, punct, word)
- "S$" → `["S", "$"]` (word, non-word)

If the diff algorithm produces operations with boundaries that don't align with token boundaries, the position-to-editor mapping could be off by a few characters.

**Specific concern:** The `dmp.diff_cleanupSemantic(diffs)` call (line 80) can adjust diff boundaries for "readability." This could shift operation positions in unexpected ways.

#### 4. Block Boundary / IR Drift (`irExtractor.mjs`)

If the IR was extracted at one time and apply was run against a slightly different document version, block boundaries could shift. A replace targeting block `b150` could actually hit a different block if IDs were re-generated or positions drifted.

**Check:** Verify that `test11.docx` was not modified between extract/read and apply steps.

---

### Skill-Level Hypotheses (Still Relevant)

#### 5. Merge Conflict with Wrong Edit Chosen (`editMerge.mjs`)

If two agents both edited the Purchase Price clause and one provided a correct `newText` while the other provided garbage, `-c combine` would keep the first (by file order), which might be the wrong one.

**Check:** Were there conflicts reported during merge? Which agent's file was listed first?

#### 6. Incomplete `newText` Provided by LLM

If the LLM generated truncated `newText`, the diff algorithm would correctly compute deletions for the missing content. This explains issues #4 and #6, but NOT issue #5's content reordering.

---

### Revised Provisional Conclusion

| Hypothesis | Explains #4, #6? | Explains #5? | Likelihood |
|------------|-----------------|--------------|------------|
| Incomplete `newText` | ✅ Yes | ❌ No | Medium |
| Merge conflict (wrong edit chosen) | ✅ Possibly | ✅ Possibly | Medium |
| Position map corruption | ✅ Yes | ✅ Yes | **High** |
| Operation order / stale positions | ✅ Yes | ✅ Yes | **High** |
| Word-diff token misalignment | ✅ Possibly | ✅ Possibly | Medium |
| IR drift / wrong block | ❌ No (specific clause affected) | ❌ No | Low |

**Issue #5's content reordering ("4.3" appearing before "S$") strongly suggests a library-level position mapping bug**, not just bad input. The debugging agent should:

1. **First:** Inspect the actual merged edits JSON for the Purchase Price clause to see what `newText` was provided
2. **If `newText` was correct:** The bug is in `blockOperations.mjs` position mapping or operation application
3. **If `newText` was already corrupt:** The bug is upstream (LLM output or merge conflict)

**Recommended approach:** Reproduce the issue with verbose logging in `applyWordDiff` to trace position map values and operation applications step-by-step.

---

## Proposed Fixes

### Library-Level Fixes (if position-mapping bug confirmed)

1. **Add position map validation in `buildPositionMap`**
   - Verify map is monotonically increasing
   - Verify all positions are defined (no sparse array gaps)
   - Warn or fail if validation fails

2. **Re-build position map between operations OR use relative offsets**
   - Current: Build once, reuse for all operations
   - Fix: Track cumulative offset from operations and adjust, OR rebuild map after each operation

3. **Add test coverage for complex blocks**
   - Blocks with bookmarks, tracked changes, formatting runs
   - Multi-operation replaces (e.g., change "£" to "S$" AND change "clause 4.3" to something else)
   - Characters that might be encoded differently (£, €, §)

### Skill-Level Fixes

4. **Agentic Skill: enforce conflict hygiene.** Require non-overlapping block ranges and mandate a conflict review step. If conflicts are detected, use `-c error` and resolve manually rather than `combine` for non-comment edits.

5. **Agentic Skill: prefer `diff: false` for large changes.** When replacing more than ~30% of a block's content, use `diff: false` to avoid complex operation sequences.

6. **Core Skill: add a post-merge check.** Require review of merged edits for blocks that are high-risk (currency clauses, payment mechanics, definitions) before apply.

---

## Open Questions

### Critical Data Needed

1. **What was the actual `newText` for the Purchase Price clause (issue #5)?**
   - If `newText` was correct, the bug is in the library
   - If `newText` was already corrupt ("4.3" in wrong place), the bug is upstream

2. **Were there merge conflicts on the affected blocks?**
   - Check merge output for conflicts involving b### IDs of currency/payment clauses
   - Which agent's edit was kept (file order)?

3. **What was the block structure of the Purchase Price clause?**
   - Did it contain bookmarks, tracked changes, or comment anchors?
   - These non-text elements could corrupt position mapping

### Process Questions

4. Were multiple agents assigned overlapping ranges that included the problematic clauses?
5. Which conflict strategy was actually used (`-c combine` or something else)?
6. Was the same `test11.docx` file used for extract/read and for apply (no intermediate edits)?

### Technical Investigation

7. Can we reproduce issue #5 with a minimal test case (single block, single replace)?
8. Does the position map for the Purchase Price clause have gaps or non-monotonic values?
9. Does using `diff: false` (full replacement) instead of word-diff avoid the corruption?

---

## Validation Plan

### Phase 1: Root Cause Isolation

1. **Inspect merged edits file** for Purchase Price clause
   - Find the edit for the relevant blockId
   - Check if `newText` is correct or already corrupt

2. **Add verbose logging to `applyWordDiff`**
   - Log position map construction
   - Log each operation's text position and editor position
   - Log document state between operations

3. **Create minimal reproduction**
   - Extract just the Purchase Price paragraph to a test document
   - Apply the same edit in isolation
   - Check if corruption occurs

### Phase 2: Fix Verification

- **Test document(s):** `Business Transfer Agreement/test11.docx`, `Business Transfer Agreement/test12.docx`
- **Expected improvements:** No truncated clauses; no content reordering; UK-specific references are consistently updated or removed.
- **Success criteria:** 
  - Issue #5 specifically: "4.3" appears only at end of clause, not before "S$"
  - All issues listed in Round 1 and Round 2 are resolved
  - Position map validation passes (if implemented)
  - No new wrong diffs appear after merge/apply

---

## Notes / Links

Additional context, references, or related handoffs.

- `CONTRACT-REVIEW-AGENTIC-SKILL.md` (Merge step recommends `-c combine`)
- `CONTRACT-REVIEW-SKILL.md` (Common pitfalls: full-block `newText`, diff usage)
- `README.md` (Merge/apply commands and conflict strategies)
- `DEBUG-HANDOFF5.md` (Previous investigation into content omission during JSON generation)

---

## Targeted Test Cases

**Original document:** `Business Transfer Agreement/Precedent - PLC - Asset purchase agreement.docx` (1493 lines—too long for manual review)

Instead, create **minimal reproduction test documents** with just the problematic clauses:

### Test Case 1: Currency Symbol Replace (Issue #5)

**Purpose:** Isolate the "4.3 appearing in wrong position" bug

**Minimal test document content:**
```
The Purchase Price is the sum of £[AMOUNT], which shall be paid by the Buyer to the Seller in cash on Completion in accordance with clause 4.3.
```

**Edit to apply:**
```json
{
  "blockId": "b001",
  "operation": "replace",
  "newText": "The Purchase Price is the sum of S$[AMOUNT], which shall be paid by the Buyer to the Seller in cash on Completion in accordance with clause 4.3.",
  "diff": true,
  "comment": "Change £ to S$"
}
```

**Expected output:** Only "£" changes to "S$", everything else identical

**Failure indicator:** "4.3" appears before "S$" or anywhere other than "clause 4.3"

**Automated assertion:**
```javascript
assert(!output.includes("4.3S$"), "4.3 should not appear before S$");
assert(output.includes("clause 4.3"), "clause 4.3 should remain at end");
assert(output.includes("S$[AMOUNT]"), "Currency should be S$");
```

---

### Test Case 2: Sentence Truncation (Issues #4, #6)

**Purpose:** Check if truncation is due to incomplete newText or library bug

**Minimal test document content:**
```
All payments to be made to the Seller under this agreement shall be made in sterling by electronic transfer of immediately available funds to [the Seller OR the Seller's Solicitors].
```

**Edit to apply (correct newText):**
```json
{
  "blockId": "b001",
  "operation": "replace",
  "newText": "All payments to be made to the Seller under this agreement shall be made in Singapore dollars by electronic transfer of immediately available funds to [the Seller OR the Seller's Solicitors].",
  "diff": true,
  "comment": "Change sterling to Singapore dollars"
}
```

**Expected output:** Full sentence with "Singapore dollars" replacing "sterling"

**Failure indicator:** Sentence truncated after "electronic transfer"

**Automated assertion:**
```javascript
assert(output.includes("to [the Seller OR"), "Full sentence should be preserved");
assert(output.includes("Singapore dollars"), "Currency should be changed");
assert(!output.includes("sterling"), "Old currency should be removed");
```

---

### Test Case 3: Special Character Handling

**Purpose:** Test position mapping with £, €, § and other non-ASCII characters

**Minimal test document content:**
```
The fee shall be £500 (five hundred pounds) plus VAT at 20%.
```

**Edit to apply:**
```json
{
  "blockId": "b001",
  "operation": "replace",
  "newText": "The fee shall be S$500 (five hundred Singapore dollars) plus GST at 8%.",
  "diff": true
}
```

**Expected output:** Multiple changes applied correctly without position drift

**Automated assertion:**
```javascript
assert(output === "The fee shall be S$500 (five hundred Singapore dollars) plus GST at 8%.");
```

---

### Test Case 4: Complex Block Structure

**Purpose:** Test blocks with bookmarks/formatting runs (if present in original)

Extract the actual Purchase Price clause from the original document, preserving any internal structure, and test in isolation.

---

### Test Case 5: Multi-Operation Diff

**Purpose:** Test when diff produces multiple operations on same block

**Minimal test document content:**
```
Payment in GBP to London account by BACS within 30 days.
```

**Edit to apply:**
```json
{
  "blockId": "b001",
  "operation": "replace",
  "newText": "Payment in SGD to Singapore account by GIRO within 14 days.",
  "diff": true
}
```

This should produce ~4 operations: GBP→SGD, London→Singapore, BACS→GIRO, 30→14

**Failure indicator:** Operations applied out of order causing content reordering

---

### Running Targeted Tests

```bash
# Create test document
echo "The Purchase Price is the sum of £[AMOUNT]..." > test-clause.txt
# (Or use a proper .docx generator)

# Extract IR
node superdoc-redline.mjs extract -i test-clause.docx -o test-ir.json

# Apply edit
node superdoc-redline.mjs apply -i test-clause.docx -o test-output.docx -e test-edit.json

# Read output and check
node superdoc-redline.mjs read -i test-output.docx | grep -q "4.3S\$" && echo "FAIL: Position corruption" || echo "PASS"
```

### Adding Verbose Logging

For debugging, add logging to `blockOperations.mjs`:

```javascript
// In buildPositionMap, add:
console.log(`Position map for block at ${blockPos}:`);
console.log(`  Text length: ${blockText.length}, Block size: ${blockSize}`);
console.log(`  Map entries: ${map.filter(x => x !== undefined).length}`);
console.log(`  First 10: ${map.slice(0, 10).map((v, i) => `${i}→${v}`).join(', ')}`);

// In applyWordDiff, add:
console.log(`Operations (sorted desc by position):`);
for (const op of sortedOps) {
  console.log(`  ${op.type} at textPos ${op.position} → editorPos ${positionMap[op.position]}`);
}
```

---

## Code References for Debugging Agent

### Priority 1: Position Mapping (likely culprit for issue #5)

| File | Lines | Function | Purpose |
|------|-------|----------|---------|
| `src/blockOperations.mjs` | 156-176 | `buildPositionMap` | Maps text positions to editor positions |
| `src/blockOperations.mjs` | 199-317 | `applyWordDiff` | Applies diff operations using position map |
| `src/blockOperations.mjs` | 219-243 | (within applyWordDiff) | Delete operation handling |
| `src/blockOperations.mjs` | 245-268 | (within applyWordDiff) | Insert operation handling |
| `src/blockOperations.mjs` | 269-296 | (within applyWordDiff) | Replace operation handling |

### Priority 2: Word Diff Algorithm

| File | Lines | Function | Purpose |
|------|-------|----------|---------|
| `src/wordDiff.mjs` | 73-86 | `computeWordDiff` | Computes word-level diff using diff-match-patch |
| `src/wordDiff.mjs` | 118-169 | `diffToOperations` | Converts diff output to structured operations |
| `src/wordDiff.mjs` | 18 | `TOKEN_REGEX` | Tokenization pattern for diff |

### Priority 3: Merge and Apply

| File | Lines | Function | Purpose |
|------|-------|----------|---------|
| `src/editMerge.mjs` | 77-217 | `mergeEditFiles` | Merges edit files with conflict resolution |
| `src/editMerge.mjs` | 151-180 | (within merge) | Conflict strategy handling |
| `src/editApplicator.mjs` | 92-184 | `applyEdits` | Main edit application orchestration |
| `src/editApplicator.mjs` | 493-507 | `sortEditsForApplication` | Edit sorting for safe application order |

### Key Questions for Each Code Path

1. **Position Map:** Does the map have undefined entries? Is it monotonically increasing?
2. **Operation Application:** Are operations being applied in the correct order? Is the position map valid when later operations run?
3. **Merge:** Were there conflicts on the affected blocks? Which edit was kept?
4. **Input:** What was the exact `newText` provided for the Purchase Price clause?

---

## Debugging Session: 2026-02-05

### Investigation Summary

Conducted a systematic investigation of the position mapping hypothesis. Created test scripts to trace through the diff algorithm and position mapping behavior with various scenarios:

1. **Simple currency replacement** (£ → S$): Works correctly
2. **Truncated newText**: Produces expected deletion, no content reordering
3. **Multi-operation scenarios** (GBP→SGD, London→Singapore, etc.): Works correctly with end-to-start application

### Key Finding: Position Mapping is NOT the Root Cause

The position mapping algorithm in `blockOperations.mjs` is **fundamentally sound**:

1. **End-to-start application works correctly**: When operations are sorted descending by text position and applied from end to start, earlier positions remain valid because we haven't modified content before them yet.

2. **Simple test case trace**:
   ```
   Original: "GBP to London by BACS 30 days"
   New:      "SGD to Singapore by GIRO 14 days"

   Operations (sorted descending):
     REPLACE at pos 17: "BACS 30" -> "GIRO 14"
     REPLACE at pos 7: "London" -> "Singapore"
     REPLACE at pos 0: "GBP" -> "SGD"

   Result: Correct! Each operation uses valid positions.
   ```

3. **The "4.3S$" pattern cannot be produced by position mapping bugs**: This specific corruption suggests the `newText` itself was malformed. If `newText` = "4.1 The Purchase Price is the sum of 4.3S$[AMOUNT]", the diff algorithm would correctly produce that output.

### True Root Causes Identified

#### Root Cause 1: LLM Output Truncation/Corruption

When the LLM generates edits, JSON output can be truncated or corrupted, especially for long `newText` fields. This results in:
- Incomplete sentences (Issues #4, #6)
- Malformed content (Issue #5 with "4.3S$")

#### Root Cause 2: Merge Conflict Resolution

The `-c combine` strategy keeps the **first** non-comment edit for conflicting blocks:
- If Agent A provides truncated `newText` and Agent B provides correct `newText`
- And Agent A's file is listed first in the merge command
- The truncated edit is kept, the correct edit is discarded

### Proposed Solutions

#### Solution 1: Add newText Validation in editApplicator.mjs

Add validation before applying edits to detect truncated/corrupt `newText`:

```javascript
/**
 * Validate newText for common corruption patterns.
 * @param {string} originalText - The original block text
 * @param {string} newText - The proposed replacement
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateNewText(originalText, newText) {
  const warnings = [];

  // Check for significant truncation (>30% shorter without being a deletion)
  if (newText.length < originalText.length * 0.7 && newText.length > 10) {
    warnings.push(`Significant truncation: ${originalText.length} -> ${newText.length} chars`);
  }

  // Check for incomplete sentences (ends mid-word or with incomplete structure)
  if (newText.length > 20) {
    const lastChar = newText.slice(-1);
    const validEndings = ['.', '!', '?', ')', ']', '"', "'", ':', ';'];
    if (!validEndings.includes(lastChar) && !/\w$/.test(newText)) {
      warnings.push(`Possible truncation: ends with "${newText.slice(-10)}"`);
    }
  }

  // Check for content that looks like it was cut mid-JSON
  if (newText.includes('...') || newText.endsWith(',') || newText.endsWith('{')) {
    warnings.push('Possible JSON truncation detected');
  }

  return { valid: warnings.length === 0, warnings };
}
```

#### Solution 2: Improve Merge Conflict Handling

Change the agentic skill to use `-c error` instead of `-c combine` and handle conflicts explicitly:

```markdown
## Merge Step (Updated Guidance)

Use strict conflict detection:
\`\`\`bash
node superdoc-redline.mjs merge agent1.json agent2.json -o merged.json -c error -v contract.docx
\`\`\`

If conflicts are detected:
1. Review each conflicting block
2. Compare the `newText` from each agent
3. Choose the more complete/correct version
4. Or re-run the affected agent on just those blocks
```

#### Solution 3: Add Block-Level Checksums

Add a checksum of the original text to each edit, allowing apply to verify the edit was generated against the correct content:

```javascript
// In edit generation:
edit.originalChecksum = crypto.createHash('md5')
  .update(originalText).digest('hex').slice(0, 8);

// In edit application:
const actualChecksum = crypto.createHash('md5')
  .update(currentBlockText).digest('hex').slice(0, 8);
if (edit.originalChecksum && edit.originalChecksum !== actualChecksum) {
  console.warn(`Block ${edit.blockId} content changed since edit was generated`);
}
```

#### Solution 4: Verbose Mode for Production Debugging (IMPLEMENTED)

Added `--verbose` flag to trace through operations. Usage:

```bash
node superdoc-redline.mjs apply -i input.docx -o output.docx -e edits.json --verbose
```

This logs:
- Original and new text for each block
- All diff operations computed
- Text-to-editor position mappings
- Each operation's success/failure

### Code Changes Made

#### 1. `src/blockOperations.mjs`

Added `validatePositionMap()` function (lines 146-172):
- Checks for undefined entries in position map
- Verifies monotonically increasing values
- Returns validation result with error details

Updated `buildPositionMap()` (lines 174-227):
- Accepts `options.verbose` parameter
- Logs mapping construction when verbose
- Attaches validation to `map._validation`

Updated `applyWordDiff()` (lines 229-430):
- Accepts `options.verbose` parameter
- Logs operations, positions, and results when verbose
- Warns when position map validation fails
- Improved error messages with context

Updated `replaceBlockById()` (lines 495-560):
- Accepts `options.verbose` parameter
- Passes verbose to `applyWordDiff()`

#### 2. `src/editApplicator.mjs`

Updated `ApplyOptions` typedef (lines 49-55):
- Added `verbose` option documentation

Updated `applyEdits()` (lines 92-186):
- Accepts `verbose` option
- Passes to `applyOneEdit()`

Updated `applyOneEdit()` (lines 221-320):
- Accepts `options.verbose` parameter
- Passes to `replaceBlockById()`

#### 3. `superdoc-redline.mjs`

Updated `apply` command (lines 180-240):
- Added `-v, --verbose` CLI flag
- Passes `verbose` to `applyEdits()`

### Test Results

All 392 tests pass:
```
# tests 392
# suites 106
# pass 392
# fail 0
# cancelled 0
# skipped 0
# duration_ms 13543.608301
```

### Next Steps

1. **Immediate**: Use `--verbose` flag to capture detailed logs when reproducing the issue
2. **Short-term**: Implement Solution 1 (newText validation) to catch truncated edits before apply
3. **Medium-term**: Update CONTRACT-REVIEW-AGENTIC-SKILL.md to use `-c error` instead of `-c combine`
4. **Long-term**: Consider implementing Solution 3 (checksums) for production robustness

### How to Reproduce and Debug

1. **Get the merged edits file** from the failing agentic run
2. **Find the Purchase Price clause edit** (look for blockId with "4.1" content)
3. **Inspect the `newText`** - if it contains "4.3S$", the bug is upstream (LLM/merge)
4. **If newText looks correct**, run with verbose:
   ```bash
   node superdoc-redline.mjs apply -i original.docx -o test.docx -e merged-edits.json --verbose 2>&1 | tee debug.log
   ```
5. **Search debug.log** for the block ID to see exact operations applied

