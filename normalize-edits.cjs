#!/usr/bin/env node
// Normalize edit files to correct format

const fs = require('fs');
const path = require('path');

const editFiles = [
  'edits-definitions.json',
  'edits-vat-tax.json',
  'edits-employment.json',
  'edits-warranties.json',
  'edits-boilerplate.json',
  'edits-schedule13.json',
  'edits-schedules.json',
  'edits-dataprotection.json'
];

let allEdits = [];

for (const file of editFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.edits && Array.isArray(data.edits)) {
      for (const edit of data.edits) {
        // Normalize operation field
        let operation = edit.operation || edit.type || edit.action;
        if (!operation && (edit.newText || edit.new || edit.replacement)) {
          operation = 'replace';
        }

        // Normalize newText field
        let newText = edit.newText || edit.new || edit.replacement || edit.text;

        // Build normalized edit
        const normalizedEdit = {
          blockId: edit.blockId || edit.block,
          operation: operation,
          diff: edit.diff !== undefined ? edit.diff : true
        };

        if (operation === 'replace' && newText) {
          normalizedEdit.newText = newText;
        }

        if (operation === 'delete') {
          // Delete operations don't need newText
          delete normalizedEdit.newText;
        }

        if (operation === 'insert') {
          normalizedEdit.afterBlockId = edit.afterBlockId;
          normalizedEdit.text = newText;
          delete normalizedEdit.newText;
        }

        if (edit.comment || edit.rationale || edit.reason) {
          normalizedEdit.comment = edit.comment || edit.rationale || edit.reason;
        }

        // Only add if we have a valid operation
        if (normalizedEdit.operation && normalizedEdit.blockId) {
          allEdits.push(normalizedEdit);
        }
      }
    }
  } catch (err) {
    console.error(`Error processing ${file}: ${err.message}`);
  }
}

// Remove duplicates (same blockId and operation)
const seen = new Set();
const uniqueEdits = [];
for (const edit of allEdits) {
  const key = `${edit.blockId}-${edit.operation}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueEdits.push(edit);
  }
}

const output = {
  version: "0.2.0",
  author: {
    name: "AI Legal Counsel",
    email: "ai@counsel.sg"
  },
  edits: uniqueEdits
};

fs.writeFileSync('normalized-edits.json', JSON.stringify(output, null, 2));
console.log(`Normalized ${uniqueEdits.length} edits to normalized-edits.json`);
