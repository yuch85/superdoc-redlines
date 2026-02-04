# Implementation Plan: Structured Document Representation (v0.2.0)

> **Version**: 0.2.0 (Breaking Change)  
> **Status**: Planning  
> **Author**: AI Implementation Team  
> **Date**: 2026-02-04

---

## Overview

This plan describes the implementation of a **Structured Intermediate Representation (IR)** system for DOCX editing by AI agents in IDE environments.

### The Problem

LLMs operating in IDE environments (Cursor, VS Code, Claude Code) need to review and edit DOCX contract files, but face significant challenges:

1. **DOCX is opaque** - Word documents are ZIP packages containing interrelated XML parts (OOXML format)
2. **Flattening loses structure** - Converting to plain text discards formatting, numbering, clause hierarchy
3. **Text-based matching is fragile** - Smart quotes, whitespace variations, and formatting markers cause match failures
4. **Position-based edits break** - When multiple edits are applied, text positions shift, invalidating subsequent edits
5. **LLMs shouldn't generate XML** - Asking LLMs to produce OOXML leads to malformed documents and formatting corruption

### The Solution

Create a **Structured Intermediate Representation (IR)** that:
- Assigns **stable identifiers** to every document block
- Provides a **token-efficient JSON format** for LLM consumption
- Enables **deterministic, ID-based edits** that don't depend on text matching
- Supports **chunked reading** for documents exceeding context windows
- Preserves document structure for accurate clause-level operations

### Key Insight from Harvey AI

From [Harvey's Word Add-In approach](https://www.harvey.ai/blog/enabling-document-wide-edits-in-harveys-word-add-in):

> "Harvey separates concerns: (1) Translate OOXML to a natural-language representation of the document. (2) Ask the model to propose edits over text. (3) Deterministically translate those edits back into precise OOXML mutations."

This is exactly what we're implementing - the LLM works with a clean representation, and we handle the OOXML complexity.

---

## Target Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  LLM Agent Workflow                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. EXTRACT: Generate structured IR from DOCX                        │
│     $ node superdoc-redline.mjs extract --input contract.docx        │
│                        ↓                                             │
│     Outputs: contract-ir.json (with stable block IDs)                │
│                                                                      │
│  2. READ: LLM reads document (with automatic chunking if needed)     │
│     $ node superdoc-redline.mjs read --input contract.docx           │
│     $ node superdoc-redline.mjs read --input contract.docx --chunk 2 │
│                        ↓                                             │
│     LLM receives: structured JSON with block IDs                     │
│                                                                      │
│  3. ANALYZE: LLM determines required changes                         │
│     LLM generates: edits.json referencing block IDs                  │
│                                                                      │
│  4. VALIDATE: Check edit instructions before applying                │
│     $ node superdoc-redline.mjs validate --input contract.docx \     │
│                                          --edits edits.json          │
│                        ↓                                             │
│     Outputs: validation report (missing IDs, conflicts)              │
│                                                                      │
│  5. APPLY: Execute ID-based edits with track changes                 │
│     $ node superdoc-redline.mjs apply --input contract.docx \        │
│                                       --output redlined.docx \       │
│                                       --edits edits.json             │
│                        ↓                                             │
│     Outputs: redlined.docx (with tracked changes + comments)         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase Summary

| Phase | Name | Scope | Key Deliverables | Dependencies |
|-------|------|-------|------------------|--------------|
| **1** | [Core Infrastructure](./phase-1-core-infrastructure.md) | Foundational modules for IR extraction | `idManager.mjs`, `editorFactory.mjs`, `irExtractor.mjs` | None |
| **2** | [Block Operations](./phase-2-block-operations.md) | ID-based editing operations | `blockOperations.mjs` (replace, delete, insert, comment) | Phase 1 |
| **3** | [Validation & Ordering](./phase-3-validation-ordering.md) | Edit validation and apply orchestration | `editApplicator.mjs` | Phases 1, 2 |
| **4** | [Chunking & Reader](./phase-4-chunking-reader.md) | Large document handling | `chunking.mjs`, `documentReader.mjs` | Phase 1 |
| **5** | [Multi-Agent Merge](./phase-5-multi-agent-merge.md) | Parallel agent support | `editMerge.mjs`, conflict resolution | Phases 1, 3 |
| **6** | [CLI Rewrite](./phase-6-cli-rewrite.md) | New CLI with subcommands | `superdoc-redline.mjs` rewrite | Phases 1-5 |
| **7** | [Docs & Integration](./phase-7-docs-integration.md) | Documentation and testing | `README.md`, `SKILL.md`, integration tests | Phases 1-6 |

---

## Critical Path

```
Phase 1 (Core) ──┬──► Phase 2 (Block Ops) ──► Phase 3 (Validation/Apply)
                 │
                 └──► Phase 4 (Chunking)
                                              ↓
                         Phase 5 (Multi-Agent) ◄─┘
                                              ↓
                              Phase 6 (CLI) ──► Phase 7 (Docs)
```

**Critical path**: Phases 1 → 2 → 3 form the core editing pipeline. Without these, nothing else works.

**Parallelizable**: Phase 4 (Chunking) can be developed in parallel with Phases 2-3 once Phase 1 is complete.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI Layer                                    │
│                    superdoc-redline.mjs                              │
├─────────────────────────────────────────────────────────────────────┤
│  extract  │   read    │  validate  │   apply   │   merge            │
├───────────┴───────────┴────────────┴───────────┴────────────────────┤
│                      Core Modules                                    │
├─────────────────────────────────────────────────────────────────────┤
│  src/irExtractor.mjs     │  Extracts structured IR from DOCX        │
│  src/documentReader.mjs  │  Reads document for LLM consumption      │
│  src/chunking.mjs        │  Splits large docs into chunks           │
│  src/blockOperations.mjs │  ID-based edit operations                │
│  src/idManager.mjs       │  Dual ID system (UUID + sequential)      │
│  src/editApplicator.mjs  │  Edit validation and application         │
│  src/editMerge.mjs       │  Multi-agent edit merging                │
├─────────────────────────────────────────────────────────────────────┤
│                    Existing Modules (Modified)                       │
├─────────────────────────────────────────────────────────────────────┤
│  src/wordDiff.mjs        │  Word-level diff (unchanged)             │
│  src/fuzzyMatch.mjs      │  Fuzzy matching (internal use only)      │
│  src/clauseParser.mjs    │  Clause detection (for IR enrichment)    │
│  src/textUtils.mjs       │  Text normalization (unchanged)          │
├─────────────────────────────────────────────────────────────────────┤
│                       SuperDoc Library                               │
│              @harbour-enterprises/superdoc                           │
│                                                                      │
│  Key APIs Used:                                                      │
│  - Editor.loadXmlData()                                              │
│  - editor.helpers.blockNode.getBlockNodes()                          │
│  - editor.helpers.blockNode.getBlockNodeById()                       │
│  - editor.commands.replaceBlockNodeById()                            │
│  - editor.commands.deleteBlockNodeById()                             │
│  - editor.state.doc.descendants()                                    │
│  - editor.exportDocx()                                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
superdoc-redlines/
├── superdoc-redline.mjs          # REWRITE: New CLI with subcommands
├── package.json                   # UPDATE: version 0.2.0
├── README.md                      # REWRITE: New documentation
├── SKILL.md                       # UPDATE: New workflow
├── src/
│   ├── irExtractor.mjs           # NEW: IR extraction
│   ├── documentReader.mjs        # NEW: Document reading for LLMs
│   ├── chunking.mjs              # NEW: Chunking system
│   ├── blockOperations.mjs       # NEW: ID-based operations
│   ├── editMerge.mjs             # NEW: Multi-agent edit merging
│   ├── editApplicator.mjs        # NEW: Edit validation and application
│   ├── idManager.mjs             # NEW: Dual ID management
│   ├── editorFactory.mjs         # NEW: SuperDoc editor setup
│   ├── wordDiff.mjs              # KEEP: Word-level diff
│   ├── fuzzyMatch.mjs            # KEEP: Internal fuzzy matching
│   ├── clauseParser.mjs          # MODIFY: Integrate with IR
│   └── textUtils.mjs             # KEEP: Text utilities
├── tests/
│   ├── irExtractor.test.mjs      # NEW
│   ├── documentReader.test.mjs   # NEW
│   ├── chunking.test.mjs         # NEW
│   ├── blockOperations.test.mjs  # NEW
│   ├── editMerge.test.mjs        # NEW: Multi-agent merge tests
│   ├── idManager.test.mjs        # NEW
│   ├── integration.test.mjs      # NEW: Full workflow tests
│   ├── multiAgent.test.mjs       # NEW: Multi-agent workflow tests
│   ├── fixtures/
│   │   ├── sample.docx           # KEEP
│   │   └── asset-purchase.docx   # NEW: Copy of test contract
│   └── output/                   # Test outputs
├── programmatic-plan/            # This directory
│   ├── index.md                  # This file
│   └── phase-*.md                # Phase specifications
└── PLAN_PROGRAMMATIC.MD          # Original monolithic plan
```

---

## Breaking Changes from v1.x

### Version Bump

```json
{
  "version": "0.2.0"
}
```

### Removed Features

| v1.x Feature | Status | Migration |
|--------------|--------|-----------|
| Text-based `find`/`replace` edits | **REMOVED** | Use ID-based `blockId` edits |
| `--inline` JSON argument | **REMOVED** | Use `--edits` file path |
| Fuzzy text matching for edits | **KEPT** (internal) | Now used only for initial structuring |
| Clause targeting by text | **REMOVED** | Use `blockId` from extracted IR |

### New CLI Structure

```bash
# OLD (v1.x) - Text-based
node superdoc-redline.mjs --config edits.json

# NEW (v0.2.0) - Subcommands
node superdoc-redline.mjs extract --input doc.docx --output ir.json
node superdoc-redline.mjs read --input doc.docx [--chunk N]
node superdoc-redline.mjs validate --input doc.docx --edits edits.json
node superdoc-redline.mjs apply --input doc.docx --output out.docx --edits edits.json
node superdoc-redline.mjs merge edits1.json edits2.json --output merged.json
```

---

## Reference Links

### SuperDoc Documentation

| Resource | URL | Description |
|----------|-----|-------------|
| **BlockNode Extension** | [docs.superdoc.dev/extensions/block-node](https://docs.superdoc.dev/extensions/block-node) | Block ID system, commands, helpers |
| **Headless Mode** | [docs.superdoc.dev/core/supereditor/configuration](https://docs.superdoc.dev/core/supereditor/configuration) | Node.js headless setup |
| **Track Changes** | [docs.superdoc.dev/extensions/track-changes](https://docs.superdoc.dev/extensions/track-changes) | Track changes extension |
| **Comments** | [docs.superdoc.dev/extensions/comments](https://docs.superdoc.dev/extensions/comments) | Comments extension |
| **AI Agents Guide** | [docs.superdoc.dev/getting-started/ai-agents](https://docs.superdoc.dev/getting-started/ai-agents) | AI integration guide |
| **Full LLM Reference** | `reference_superdoc/llms-full.txt` | Complete API documentation |

### Reference Implementations

| Resource | Path | Description |
|----------|------|-------------|
| **contract-playbook-ai** | `reference_contract-playbook-ai/` | Working implementation with block IDs |
| **SuperdocEditor.tsx** | `reference_contract-playbook-ai/components/superdoc/SuperdocEditor.tsx` | structureDocument, getClauses, updateClause |
| **wordAdapter.ts** | `reference_contract-playbook-ai/services/wordAdapter.ts` | Document parsing |

### Background Reading

| Resource | URL | Description |
|----------|-----|-------------|
| **Harvey Approach** | [harvey.ai/blog/enabling-document-wide-edits](https://www.harvey.ai/blog/enabling-document-wide-edits-in-harveys-word-add-in) | Inspiration for architecture |

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@harbour-enterprises/superdoc` | `^1.0.0` | Core document manipulation |
| `commander` | `^12.0.0` | CLI framework |
| `jsdom` | `^24.0.0` | DOM environment for headless mode |
| `diff-match-patch` | `^1.0.5` | Word-level diff algorithm |

---

## Notes for Implementing Agent

1. **Test with the provided fixture**: `Business Transfer Agreement/Precedent - PLC - Asset purchase agreement.docx`

2. **SuperDoc's `sdBlockId`**: This is automatically assigned by SuperDoc when blocks are created. We add our own logic to ensure all blocks have IDs after loading.

3. **The `seqId` attribute**: This is our custom attribute. It may not persist through SuperDoc export/import, but that's okay - we regenerate them on extraction and include the mapping in the IR.

4. **Chunking**: The outline should be included in EVERY chunk so the LLM has context about document structure regardless of which chunk it's reading.

5. **Error handling**: All operations should return structured results with `success`, `error`, and relevant metadata - never throw exceptions from the main API.

6. **Track changes**: The `documentMode: 'suggesting'` setting enables track changes. This must be set before any edit operations.

7. **Comment structure**: SuperDoc expects comments in ProseMirror JSON format. See existing `createCommentElements()` in the current codebase for the correct structure.

8. **Multi-agent merge order matters**: When merging edits from multiple sub-agents, the order of the edit files passed to `merge` determines priority for `first`/`last` conflict strategies.

9. **Reverse document order application**: This is critical for correctness. Always sort edits by position descending before applying. This ensures position shifts from earlier (in application order) edits don't affect later edits.

10. **IR is immutable during sub-agent work**: The extracted IR should be treated as read-only by all sub-agents. They produce edit JSONs; they never modify the IR or document directly.

11. **Block ID resolution**: The `resolveBlockId()` function must handle both UUID and seqId formats. Check if the ID matches `^b\d+$` pattern to determine if it's a seqId.

---

## Quick Navigation

- [Phase 1: Core Infrastructure](./phase-1-core-infrastructure.md)
- [Phase 2: Block Operations](./phase-2-block-operations.md)
- [Phase 3: Validation & Ordering](./phase-3-validation-ordering.md)
- [Phase 4: Chunking & Reader](./phase-4-chunking-reader.md)
- [Phase 5: Multi-Agent Merge](./phase-5-multi-agent-merge.md)
- [Phase 6: CLI Rewrite](./phase-6-cli-rewrite.md)
- [Phase 7: Docs & Integration](./phase-7-docs-integration.md)
