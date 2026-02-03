# superdoc-redlines

A Node.js CLI tool for applying tracked changes and comments to DOCX files using [SuperDoc](https://superdoc.dev) in headless mode.

Designed for use by AI agents (Claude, GPT, etc.) in IDE environments like Cursor, VS Code, or Claude Code.

## Features

- **Fuzzy Matching** - Smart quote normalization, variable whitespace, markdown handling
- **Occurrence Selector** - Target nth occurrence or replace all occurrences
- **Word-Level Diff** - Compute minimal tracked changes from original/new text
- **Clause Targeting** - Target document sections by clause number or heading

## Installation

```bash
npm install
```

## Quick Start

```bash
# Using a config file
node superdoc-redline.mjs --config edits.json

# Using inline JSON
node superdoc-redline.mjs --inline '{"input":"contract.docx","output":"redlined.docx","edits":[{"find":"foo","replace":"bar"}]}'

# Using separate arguments
node superdoc-redline.mjs \
  --input contract.docx \
  --output redlined.docx \
  --author-name "AI Assistant" \
  --author-email "ai@example.com" \
  --edits '[{"find":"English law","replace":"Singapore law","comment":"Per Deal Context"}]'
```

## Configuration Format

### JSON Config File

```json
{
  "input": "path/to/contract.docx",
  "output": "path/to/redlined.docx",
  "author": {
    "name": "AI Assistant",
    "email": "ai@example.com"
  },
  "edits": [
    {
      "find": "English law",
      "replace": "Singapore law",
      "comment": "Per Deal Context: Singapore governing law"
    },
    {
      "find": "TUPE 2006",
      "replace": "",
      "comment": "DELETE: Singapore has no TUPE equivalent"
    },
    {
      "find": "Data Protection Act 1998",
      "comment": "Review: Should be replaced with PDPA 2012"
    }
  ]
}
```

## Edit Types

### Standard Find/Replace

| Type | Fields | Description |
|------|--------|-------------|
| Replace + Comment | `find`, `replace`, `comment` | Replace text with tracked change AND add comment |
| Replace Only | `find`, `replace` | Replace text with tracked change (no comment) |
| Comment Only | `find`, `comment` | Add comment to existing text (no change) |
| Delete | `find`, `replace: ""` | Delete text (replace with empty string) |

### Occurrence Selector

Target specific occurrences of text instead of just the first match:

```json
{
  "find": "the Seller",
  "replace": "the Vendor",
  "occurrence": 2,
  "comment": "Replace second occurrence only"
}
```

```json
{
  "find": "the Seller",
  "replace": "the Vendor",
  "all": true,
  "comment": "Global terminology change"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `occurrence` | `number` | Target the nth occurrence (1-indexed) |
| `all` | `boolean` | Replace ALL occurrences when `true` |

### Word-Level Diff

Compute minimal tracked changes by providing original and new text:

```json
{
  "type": "diff",
  "originalText": "This Agreement shall be governed by English law.",
  "newText": "This Agreement shall be governed by Singapore law.",
  "comment": "Governing law change"
}
```

Only the word "English" will be shown as deleted and "Singapore" as inserted, rather than replacing the entire sentence.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"diff"` | Indicates word-level diff edit |
| `originalText` | `string` | The original text to find in document |
| `newText` | `string` | The new text to replace it with |
| `comment` | `string` | Optional comment to add |

### Clause Targeting

Target document sections by clause number or heading:

```json
{
  "type": "clause",
  "clauseNumber": "3.2",
  "replace": "3.2 New clause text...",
  "comment": "Rewrote warranties clause"
}
```

```json
{
  "type": "clause",
  "clauseHeading": "Definitions",
  "comment": "Review all defined terms"
}
```

```json
{
  "type": "clause",
  "clauseNumber": "8.4",
  "delete": true,
  "comment": "Removed TUPE clause"
}
```

```json
{
  "type": "clause",
  "insertAfter": "2.1",
  "newClauseNumber": "2.2",
  "text": "New clause content...",
  "comment": "Added new condition"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"clause"` | Indicates clause-targeted edit |
| `clauseNumber` | `string` | Target by clause number (e.g., "3.2", "1.1.1") |
| `clauseHeading` | `string` | Target by clause heading (case-insensitive) |
| `replace` | `string` | New text to replace clause content |
| `delete` | `boolean` | Delete the entire clause when `true` |
| `diff` | `boolean` | Use word-level diff for replacement when `true` |
| `insertAfter` | `string` | Clause number to insert after |
| `newClauseNumber` | `string` | Number for the new clause |
| `text` | `string` | Text for new clause (with `insertAfter`) |
| `includeSubclauses` | `boolean` | Include nested clauses (default: `true`) |
| `comment` | `string` | Optional comment to add |

#### Supported Clause Number Formats

| Format | Example | Pattern |
|--------|---------|---------|
| Numbered | `1.`, `3.2`, `1.2.3.4` | `^(\d+(?:\.\d+)*)\.?\s+` |
| Lettered | `(a)`, `(B)` | `^\([a-z]\)\s*` |
| Roman | `i.`, `iv.`, `xiii.` | `^([ivxlcdm]+)\.\s*` |
| Bracketed | `[1]`, `[2]` | `^\[(\d+)\]\s*` |
| Article | `Article 5`, `Article III` | `^Article\s+(\d+\|[IVXLCDM]+)` |
| Schedule | `Schedule 1`, `Exhibit A` | `^(Schedule\|Exhibit\|Appendix\|Annex)\s+` |

## Fuzzy Matching

Text matching uses a 3-tier progressive strategy:

### Tier 1: Exact Match
Direct string matching - fastest and most precise.

### Tier 2: Smart Quote Normalization
Automatically matches smart/curly quotes with straight quotes:
- `"Hello"` matches `"Hello"` (smart double quotes)
- `It's` matches `It's` (smart apostrophe)

### Tier 3: Fuzzy Regex
Handles common document variations:
- **Variable whitespace**: `hello world` matches `hello   world` or `hello\nworld`
- **Variable underscores**: `[___]` matches `[__________]` (placeholder fields)
- **Markdown formatting**: `Hello world` matches `**Hello** world`

## CLI Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to JSON config file |
| `-i, --inline <json>` | Inline JSON configuration |
| `--input <path>` | Input DOCX file path |
| `--output <path>` | Output DOCX file path |
| `--author-name <name>` | Author name for track changes (default: "AI Assistant") |
| `--author-email <email>` | Author email for track changes (default: "ai@example.com") |
| `--edits <json>` | JSON array of edits |
| `-V, --version` | Output version number |
| `-h, --help` | Display help |

## Output Format

The CLI outputs JSON-style information about the processing:

```
Loading document: /path/to/contract.docx
Processing 5 edit(s)...
Applied: 4, Skipped: 1
Comments added: 3
Skipped edits:
  [2] "nonexistent text" - Text not found
Exporting to: /path/to/redlined.docx
Done!
```

The result includes details about each edit:

```json
{
  "applied": 4,
  "skipped": [
    {
      "index": 2,
      "find": "nonexistent text",
      "reason": "Text not found",
      "occurrencesFound": 0
    }
  ],
  "details": [
    { "index": 0, "find": "the Seller", "matchCount": 12, "mode": "all" },
    { "index": 1, "find": "English law", "matchCount": 1, "mode": "first" },
    { "index": 3, "type": "diff", "stats": { "insertions": 1, "deletions": 1, "unchanged": 8 } },
    { "index": 4, "type": "clause", "clauseNumber": "7.2", "operation": "replace" }
  ]
}
```

## Module API

The following modules can be imported for programmatic use:

### `src/fuzzyMatch.mjs`

```javascript
import { findTextFuzzy, makeFuzzyRegex, replaceSmartQuotes } from './src/fuzzyMatch.mjs';

// Replace smart quotes with straight quotes
replaceSmartQuotes('"Hello"')  // Returns: "Hello"

// Create a fuzzy regex pattern
const regex = makeFuzzyRegex('hello world');
regex.test('hello   world');  // true
regex.test('**hello** world'); // true

// Find text with 3-tier matching
const result = findTextFuzzy(documentText, searchText);
// Returns: { start, end, matchedText, tier } or null
// tier is 'exact', 'smartQuote', or 'fuzzy'
```

### `src/wordDiff.mjs`

```javascript
import { tokenize, computeWordDiff, getDiffStats, diffToOperations } from './src/wordDiff.mjs';

// Tokenize text into words, punctuation, whitespace
tokenize('Hello, world!')  // ['Hello', ',', ' ', 'world', '!']

// Compute word-level diff
const diffs = computeWordDiff('Hello world', 'Hello there');
// Returns: [[0, 'Hello '], [-1, 'world'], [1, 'there']]
// Operations: 0 = equal, -1 = delete, 1 = insert

// Get diff statistics
const stats = getDiffStats('The quick fox', 'The slow fox');
// Returns: { insertions: 1, deletions: 1, unchanged: 4 }

// Convert to structured operations
const ops = diffToOperations('English law', 'Singapore law');
// Returns: [{ type: 'replace', position: 0, deleteText: 'English ', insertText: 'Singapore ' }]
```

### `src/clauseParser.mjs`

```javascript
import {
  parseClauseNumber,
  analyzeHeading,
  buildClauseStructure,
  findClause,
  getClauseRange,
  extractClauseText,
  Clause
} from './src/clauseParser.mjs';

// Parse clause number from text
parseClauseNumber('3.2.1 Warranties')
// Returns: { type: 'numbered', number: '3.2.1', remainder: 'Warranties' }

parseClauseNumber('(a) First item')
// Returns: { type: 'lettered', number: 'a', remainder: 'First item' }

// Analyze if text is a heading
analyzeHeading(node, 'DEFINITIONS')
// Returns: { isHeading: true, level: 1, title: 'DEFINITIONS' }

// Build clause structure from ProseMirror document
const { clauses, index } = buildClauseStructure(doc);
// clauses: Array of top-level Clause objects with children
// index: Map for quick lookup by number or heading

// Find a clause
const clause = findClause(index, { number: '3.2' });
const clause = findClause(index, { heading: 'Warranties' });

// Get clause position range
const { from, to } = getClauseRange(clause, includeSubclauses);

// Extract clause text
const text = extractClauseText(doc, clause, includeSubclauses);
```

### `src/textUtils.mjs`

```javascript
import { normalizeWhitespace, normalizeText } from './src/textUtils.mjs';

// Replace non-breaking spaces with regular spaces
normalizeWhitespace('hello\u00a0world')  // 'hello world'

// Full normalization (whitespace + smart quotes)
normalizeText('"Hello"\u00a0world')  // '"Hello" world'
```

## For AI Agents

This tool is designed to be called by AI agents in IDE environments. The agent generates a JSON configuration and invokes the CLI:

```bash
# Agent workflow:
# 1. Analyze document and generate edits
# 2. Write edits.json to /tmp or workspace
# 3. Call this CLI

node /path/to/superdoc-redlines/superdoc-redline.mjs \
  --config /tmp/edits.json
```

### Example: Global Terminology Change

```json
{
  "input": "contract.docx",
  "output": "redlined.docx",
  "author": { "name": "AI Assistant", "email": "ai@firm.com" },
  "edits": [
    {
      "find": "the Seller",
      "replace": "the Vendor",
      "all": true,
      "comment": "Global: Standardize terminology"
    }
  ]
}
```

### Example: Clause Rewrite with Minimal Changes

```json
{
  "input": "contract.docx",
  "output": "redlined.docx",
  "author": { "name": "AI Assistant", "email": "ai@firm.com" },
  "edits": [
    {
      "type": "clause",
      "clauseNumber": "7.2",
      "replace": "7.2 Governing Law\n\nThis Agreement shall be governed by Singapore law.",
      "diff": true,
      "comment": "Changed governing law from English to Singapore"
    }
  ]
}
```

### Example: Mixed Edit Types

```json
{
  "input": "asset_purchase_agreement.docx",
  "output": "redlined.docx",
  "author": { "name": "Deal Counsel", "email": "counsel@firm.com" },
  "edits": [
    {
      "type": "clause",
      "clauseHeading": "Definitions",
      "comment": "Review all defined terms for Singapore context"
    },
    {
      "type": "diff",
      "originalText": "The Seller shall deliver the Goods within 30 days.",
      "newText": "The Vendor shall deliver the Products within 14 business days.",
      "comment": "Updated terms per negotiation"
    },
    {
      "find": "TUPE",
      "replace": "",
      "all": true,
      "comment": "Remove all TUPE references - not applicable in Singapore"
    },
    {
      "type": "clause",
      "clauseNumber": "8.4",
      "delete": true,
      "comment": "Deleted: Singapore has no TUPE equivalent"
    }
  ]
}
```

## How It Works

1. **JSDOM Setup**: Creates a DOM environment for SuperDoc's headless mode
2. **Load DOCX**: Uses `Editor.loadXmlData()` to parse the Word document
3. **Track Changes Mode**: Opens editor with `documentMode: 'suggesting'`
4. **Fuzzy Matching**: Uses 3-tier progressive matching to find text
5. **Position Mapping**: Converts text search results to ProseMirror positions
6. **Apply Edits**: Processes edits in reverse document order to avoid position shifts
7. **Word Diff**: For `type: "diff"` edits, computes minimal changes using diff-match-patch
8. **Clause Parsing**: For `type: "clause"` edits, builds document structure and targets clauses
9. **Add Comments**: Uses `editor.commands.insertComment()` at selection
10. **Export**: Writes redlined DOCX with `editor.exportDocx()`

## Testing

```bash
npm test
```

Tests use Node.js built-in test runner (`node:test`):
- `tests/fuzzyMatch.test.mjs` - Fuzzy matching tests (33 tests)
- `tests/wordDiff.test.mjs` - Word-level diff tests (27 tests)
- `tests/clauseParser.test.mjs` - Clause parsing tests (35 tests)
- `tests/occurrence.test.mjs` - Occurrence selector tests
- `tests/redline.test.mjs` - Integration tests (requires `unzip`)

## Dependencies

- `@harbour-enterprises/superdoc` - Word document manipulation
- `commander` - CLI argument parsing
- `jsdom` - DOM environment for headless mode
- `diff-match-patch` - Word-level diff computation

## License

MIT
