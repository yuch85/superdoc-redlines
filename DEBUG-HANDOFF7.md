# Debug Handoff 7 - Contract Review Skill Issues

**Date:** 2026-02-05
**Task:** UK to Singapore conversion of PLC Asset Purchase Agreement
**Output:** test13.docx (58 edits applied successfully)

---

## Fixes Implemented (2026-02-05)

### P1 Fixed: Trailing Comma False Positive

**File:** `src/editApplicator.mjs`

**Change:** Modified `validateNewText()` to compare trailing comma patterns with original text before flagging as error.

```javascript
// Before: Unconditionally flagged any trailing comma as error
{ pattern: /,\s*$/, msg: 'Ends with trailing comma' }

// After: Only flags if original doesn't also end with comma
{ pattern: /,\s*$/, msg: 'Ends with trailing comma', checkOriginal: true }
```

**Verification:**
```bash
$ node superdoc-redline.mjs validate --input doc.docx --edits test13-edits.json
{
  "valid": true,      # Was false before fix
  "issues": [],       # Was 1 (content_corruption) before fix
  "warnings": [...]   # Expected content reduction warnings only
}
```

**Test Added:** `tests/editApplicator.test.mjs`
- "allows trailing comma when original also ends with comma (list items)"

### P0 Fixed: Documentation Updated

**File:** `CONTRACT-REVIEW-SKILL.md`

**Added explicit schema section with:**
- Required field names table (`blockId`, `operation`, `newText`)
- Common errors table (wrong field names like `searchText`, `replaceText`)
- Validation errors explanation

---

## Issues Encountered

### 1. Field Naming Inconsistency in Edits JSON Schema

**Severity:** Critical (blocked all edits from validating)

**Problem:**
The edits JSON file was created using `searchText` and `replaceText` field names, but the superdoc-redlines library expects `oldText` and `newText`.

**Error Message:**
```json
{
  "editIndex": 0,
  "type": "missing_field",
  "blockId": "b149",
  "message": "Replace operation requires newText field"
}
```
This error repeated for all 58 edits.

**Root Cause:**
The CONTRACT-REVIEW-SKILL.md documentation (or the agent's training) used different field names than what the library actually accepts. The agent generated edits with:
```json
{
  "blockId": "b149",
  "operation": "replace",
  "searchText": "...",   // WRONG
  "replaceText": "..."   // WRONG
}
```

But the library expects:
```json
{
  "blockId": "b149",
  "operation": "replace",
  "oldText": "...",      // CORRECT
  "newText": "..."       // CORRECT
}
```

**Fix Applied:**
Used sed to rename fields: `sed -i 's/"searchText"/"oldText"/g; s/"replaceText"/"newText"/g' test13-edits.json`

**Suggested Documentation Fix:**
Update CONTRACT-REVIEW-SKILL.md to explicitly show the correct field names. Add a schema reference section:

```markdown
## Edits JSON Schema

Each edit object must use these exact field names:
- `blockId` (required): The block ID from the IR file (e.g., "b149")
- `operation` (required): "replace", "delete", or "insert"
- `oldText` (required for replace): The exact text to find
- `newText` (required for replace): The replacement text
- `comment` (optional): Explanation of the change

**WARNING:** Do NOT use `searchText`/`replaceText` - these are not valid field names.
```

---

### 2. False Positive: Trailing Comma Validation Error

**Severity:** Medium (blocked apply until bypassed)

**Problem:**
The validator flagged block b400 as having "content_corruption" because the `newText` ended with a trailing comma.

**Error Message:**
```json
{
  "editIndex": 28,
  "type": "content_corruption",
  "blockId": "b400",
  "message": "newText validation failed: Likely truncation: Ends with trailing comma"
}
```

**Actual Content:**
```json
{
  "blockId": "b400",
  "operation": "replace",
  "oldText": "all salaries, wages, bonuses, commissions, maternity pay, paternity pay, accrued holiday entitlement and holiday pay entitlement, and other emoluments including but not limited to PAYE income tax, National Insurance contributions, health insurance, death in service benefits, season ticket loans and any contributions to pension arrangements,",
  "newText": "all salaries, wages, bonuses, commissions, maternity pay, paternity pay, accrued annual leave entitlement and annual leave pay entitlement, and other emoluments including but not limited to income tax withholding, Central Provident Fund contributions, health insurance, death in service benefits, and any contributions to supplementary retirement schemes,"
}
```

**Why This Is a False Positive:**
Both the original text AND the replacement text end with commas. This is correct because the text is part of a larger list item in the document that continues after this block. The validator incorrectly assumes a trailing comma indicates truncation.

**Fix Applied:**
Used `--no-validate` flag to bypass validation:
```bash
node superdoc-redline.mjs apply --no-validate ...
```

**Suggested Library Fix:**
The validation logic in the library should be improved:

1. **Compare oldText and newText patterns**: If `oldText` also ends with a comma, don't flag `newText` ending with a comma as corruption.

2. **Check document context**: Before flagging trailing punctuation, verify if the original block in the document also ends with that punctuation.

3. **Make this a warning, not an error**: Trailing comma could be intentional in list contexts.

**Suggested Code Change** (in validation logic):
```javascript
// In validation for trailing punctuation
if (newText.endsWith(',')) {
  // Only flag if oldText doesn't also end with comma
  if (!oldText.endsWith(',')) {
    issues.push({
      type: 'content_corruption',
      message: 'Likely truncation: Ends with trailing comma'
    });
  }
  // Otherwise, it's probably intentional - the block is part of a list
}
```

---

### 3. Overly Aggressive Content Reduction Warnings

**Severity:** Low (warnings only, did not block)

**Problem:**
The validator issued warnings for legitimate edits that significantly reduced content length.

**Warnings:**
```json
{
  "editIndex": 18,
  "type": "content_warning",
  "blockId": "b258",
  "message": "Significant content reduction (79%): 195 → 40 chars"
},
{
  "editIndex": 35,
  "type": "content_warning",
  "blockId": "b438",
  "message": "Significant content reduction (61%): 375 → 146 chars"
}
```

**Why These Are Legitimate:**

**b258 (TUPE definition):**
- Original: Long UK TUPE definition with predecessor regulations
- Replacement: Short Singapore Employment Act reference
- Reason: Singapore has no TUPE equivalent. The verbose UK definition must be replaced with a simple Employment Act reference.

**b438 (Option to tax):**
- Original: Detailed UK VAT option to tax undertaking
- Replacement: Note explaining Singapore GST doesn't have this concept
- Reason: The UK "option to tax" for property doesn't exist in Singapore GST regime. The entire provision becomes a note.

**Suggested Documentation Update:**
The CONTRACT-REVIEW-SKILL.md should note that significant content reduction is expected when:
- UK concepts have no Singapore equivalent
- UK statutory definitions are being replaced with simpler Singapore references
- Provisions are being converted to explanatory notes

**Suggested Library Enhancement:**
Add a `--expected-reduction` or `--allow-reduction` flag, or add a field in the edit object:
```json
{
  "blockId": "b258",
  "operation": "replace",
  "oldText": "...",
  "newText": "...",
  "allowContentReduction": true,
  "comment": "Singapore has no TUPE equivalent"
}
```

---

### 4. Session Context Loss

**Severity:** Medium (caused workflow disruption)

**Problem:**
The Claude session ran out of context and was summarized. When continued, key details were lost:
- The exact edits file structure that had been created
- The specific field names used in the edits
- Progress through the document chunks

**Impact:**
Had to re-read the edits file and re-discover the field naming issue that had apparently been present from the start.

**Suggested Skill Enhancement:**
For large documents, the skill should:
1. Save progress checkpoints to a state file
2. Log key decisions (like field names used) to a separate log file
3. Include a "resume" command that can pick up from a saved state

---

### 5. No Schema Validation on Edit Creation

**Severity:** Medium (issues only discovered at apply time)

**Problem:**
The agent created an entire edits file with wrong field names, and this was only discovered when running `validate` command. There's no early feedback during edit creation.

**Suggested Improvement:**
Add a `--schema` flag to the `validate` command that can be run incrementally:
```bash
# Validate a single edit JSON blob
echo '{"blockId":"b001","operation":"replace","oldText":"...","newText":"..."}' | \
  node superdoc-redline.mjs validate-edit --schema
```

Or provide a JSON schema file that editors/agents can use for real-time validation.

---

## Summary of Suggested Fixes

### Documentation Fixes (CONTRACT-REVIEW-SKILL.md)

1. **Add explicit schema section** showing correct field names (`oldText`/`newText`)
2. **Add warning box** about common field name mistakes
3. **Document expected warnings** for jurisdiction conversion tasks
4. **Add troubleshooting section** for validation errors

### Library Fixes (superdoc-redlines)

1. **Improve trailing punctuation validation**: Compare with oldText before flagging
2. **Add edit-level flags**: `allowContentReduction`, `expectedReduction`
3. **Provide JSON schema file**: For agent/editor validation
4. **Add incremental validation**: Validate single edits during creation
5. **Better error messages**: Suggest correct field names when wrong ones detected

### Skill Fixes (claude-review)

1. **Add state persistence**: Save progress for long documents
2. **Add schema validation prompt**: Include JSON schema in agent context
3. **Add pre-flight check**: Validate a sample edit before generating all edits

---

## Files Created This Session

| File | Purpose |
|------|---------|
| `test13-edits.json` | 58 edits for UK→Singapore conversion |
| `test13.docx` | Final output with tracked changes |
| `asset-purchase-ir.json` | Extracted document structure (from earlier) |

---

## Commands Used

```bash
# Validate edits (found field name issues)
node superdoc-redline.mjs validate --input "../Business Transfer Agreement/Precedent - PLC - Asset purchase agreement.docx" --edits test13-edits.json

# Fix field names
sed -i 's/"searchText"/"oldText"/g; s/"replaceText"/"newText"/g' test13-edits.json

# Apply with validation bypass (due to false positive)
node superdoc-redline.mjs apply --input "../Business Transfer Agreement/Precedent - PLC - Asset purchase agreement.docx" --output test13.docx --edits test13-edits.json --author-name "AI Legal Counsel" --no-validate
```

---

## Recommendation Priority

| Priority | Issue | Fix |
|----------|-------|-----|
| P0 | Field naming inconsistency | Update docs + add schema |
| P1 | Trailing comma false positive | Fix validation logic |
| P2 | Content reduction warnings | Add edit-level flags |
| P3 | Session context loss | Add state persistence |
