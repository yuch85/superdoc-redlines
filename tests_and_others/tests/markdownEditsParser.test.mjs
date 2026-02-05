/**
 * Tests for Markdown Edits Parser - Parse and generate markdown edit format.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMarkdownEdits, editsToMarkdown } from '../../src/markdownEditsParser.mjs';

describe('parseMarkdownEdits', () => {
  describe('table parsing', () => {
    it('should parse delete operations', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b257 | delete | - | DELETE TULRCA |
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].blockId, 'b257');
      assert.strictEqual(result.edits[0].operation, 'delete');
      assert.strictEqual(result.edits[0].comment, 'DELETE TULRCA');
      assert.strictEqual(result.edits[0].diff, undefined);
    });

    it('should parse replace operations with diff: true', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b165 | replace | true | Change jurisdiction |

### b165 newText
Business Day: a day in Singapore.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].blockId, 'b165');
      assert.strictEqual(result.edits[0].operation, 'replace');
      assert.strictEqual(result.edits[0].diff, true);
      assert.strictEqual(result.edits[0].comment, 'Change jurisdiction');
      assert.strictEqual(result.edits[0].newText, 'Business Day: a day in Singapore.');
    });

    it('should parse replace operations with diff: false', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b100 | replace | false | Full replacement |

### b100 newText
Completely new content here.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].blockId, 'b100');
      assert.strictEqual(result.edits[0].operation, 'replace');
      assert.strictEqual(result.edits[0].diff, false);
      assert.strictEqual(result.edits[0].newText, 'Completely new content here.');
    });

    it('should parse comment operations', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b042 | comment | - | Please review this clause |
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].blockId, 'b042');
      assert.strictEqual(result.edits[0].operation, 'comment');
      assert.strictEqual(result.edits[0].comment, 'Please review this clause');
      assert.strictEqual(result.edits[0].diff, undefined);
    });

    it('should parse insert operations', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b449 | insert | - | Insert Singapore employment clause |

### b449 insertText
The Buyer shall offer employment to each Employee.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].afterBlockId, 'b449');
      assert.strictEqual(result.edits[0].blockId, undefined);
      assert.strictEqual(result.edits[0].operation, 'insert');
      assert.strictEqual(result.edits[0].comment, 'Insert Singapore employment clause');
      assert.strictEqual(result.edits[0].text, 'The Buyer shall offer employment to each Employee.');
    });

    it('should handle multiple edits in a table', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | delete | - | Remove header |
| b002 | replace | true | Update clause |
| b003 | comment | - | Review needed |
| b004 | insert | - | Add new section |

### b002 newText
Updated clause content.

### b004 insertText
New section content goes here.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 4);

      // First edit - delete
      assert.strictEqual(result.edits[0].blockId, 'b001');
      assert.strictEqual(result.edits[0].operation, 'delete');

      // Second edit - replace
      assert.strictEqual(result.edits[1].blockId, 'b002');
      assert.strictEqual(result.edits[1].operation, 'replace');
      assert.strictEqual(result.edits[1].diff, true);
      assert.strictEqual(result.edits[1].newText, 'Updated clause content.');

      // Third edit - comment
      assert.strictEqual(result.edits[2].blockId, 'b003');
      assert.strictEqual(result.edits[2].operation, 'comment');

      // Fourth edit - insert
      assert.strictEqual(result.edits[3].afterBlockId, 'b004');
      assert.strictEqual(result.edits[3].operation, 'insert');
      assert.strictEqual(result.edits[3].text, 'New section content goes here.');
    });
  });

  describe('metadata parsing', () => {
    it('should parse author metadata', () => {
      const markdown = `
## Metadata

- **Author Name**: John Smith
- **Author Email**: john.smith@example.com

## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | delete | - | Remove |
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.author.name, 'John Smith');
      assert.strictEqual(result.author.email, 'john.smith@example.com');
    });

    it('should use defaults when metadata missing', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | delete | - | Remove |
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.author.name, '');
      assert.strictEqual(result.author.email, '');
      assert.strictEqual(result.version, '');
    });

    it('should parse version from metadata', () => {
      const markdown = `
## Metadata

- **Version**: 1.2.3
- **Author Name**: Jane Doe
- **Author Email**: jane@example.com

## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | delete | - | Remove |
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.version, '1.2.3');
      assert.strictEqual(result.author.name, 'Jane Doe');
      assert.strictEqual(result.author.email, 'jane@example.com');
    });
  });

  describe('newText section parsing', () => {
    it('should handle multi-line newText', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b050 | replace | true | Multi-line update |

### b050 newText
This is line one.
This is line two.
This is line three.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].newText, 'This is line one.\nThis is line two.\nThis is line three.');
    });

    it('should handle newText with special characters', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b099 | replace | false | Special chars |

### b099 newText
The amount is $1,000.00 (one thousand dollars).
Section 1.2(a)(i) applies here.
Use "quotation marks" and 'apostrophes'.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.ok(result.edits[0].newText.includes('$1,000.00'));
      assert.ok(result.edits[0].newText.includes('Section 1.2(a)(i)'));
      assert.ok(result.edits[0].newText.includes('"quotation marks"'));
    });

    it('should handle multiple newText sections', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b010 | replace | true | First update |
| b020 | replace | true | Second update |

### b010 newText
First replacement content.

### b020 newText
Second replacement content.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 2);
      assert.strictEqual(result.edits[0].newText, 'First replacement content.');
      assert.strictEqual(result.edits[1].newText, 'Second replacement content.');
    });

    it('should match newText to correct blockId', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b111 | replace | true | Update 111 |
| b222 | delete | - | Delete 222 |
| b333 | replace | true | Update 333 |

### b333 newText
Content for block 333.

### b111 newText
Content for block 111.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 3);

      // b111 should have its newText
      assert.strictEqual(result.edits[0].blockId, 'b111');
      assert.strictEqual(result.edits[0].newText, 'Content for block 111.');

      // b222 delete should not have newText
      assert.strictEqual(result.edits[1].blockId, 'b222');
      assert.strictEqual(result.edits[1].newText, undefined);

      // b333 should have its newText
      assert.strictEqual(result.edits[2].blockId, 'b333');
      assert.strictEqual(result.edits[2].newText, 'Content for block 333.');
    });
  });

  describe('insertText section parsing', () => {
    it('should parse insertText sections', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b500 | insert | - | Add new clause |

### b500 insertText
This is the new clause that will be inserted.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].operation, 'insert');
      assert.strictEqual(result.edits[0].text, 'This is the new clause that will be inserted.');
    });

    it('should convert blockId to afterBlockId for insert', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b700 | insert | - | Insert after b700 |

### b700 insertText
New content to insert.
`;

      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].afterBlockId, 'b700');
      assert.strictEqual(result.edits[0].blockId, undefined);
      assert.strictEqual(result.edits[0].text, 'New content to insert.');
    });
  });

  describe('error handling', () => {
    it('should skip malformed table rows', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | delete | - | Valid row |
| invalid | notanop | - | Invalid operation |
| b002 | replace | true | Another valid row |

### b002 newText
Valid replacement.
`;

      const result = parseMarkdownEdits(markdown);

      // Should have 2 valid edits, skipping the malformed one
      assert.strictEqual(result.edits.length, 2);
      assert.strictEqual(result.edits[0].blockId, 'b001');
      assert.strictEqual(result.edits[1].blockId, 'b002');
    });

    it('should warn on missing newText for replace', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | replace | true | Missing newText |
`;

      // This should still parse but newText will be undefined
      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].operation, 'replace');
      assert.strictEqual(result.edits[0].newText, undefined);
    });

    it('should warn on missing insertText for insert', () => {
      const markdown = `
## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | insert | - | Missing insertText |
`;

      // This should still parse but text will be undefined
      const result = parseMarkdownEdits(markdown);

      assert.strictEqual(result.edits.length, 1);
      assert.strictEqual(result.edits[0].operation, 'insert');
      assert.strictEqual(result.edits[0].text, undefined);
    });

    it('should handle empty input gracefully', () => {
      const result1 = parseMarkdownEdits('');
      assert.deepStrictEqual(result1, {
        version: '',
        author: { name: '', email: '' },
        edits: []
      });

      const result2 = parseMarkdownEdits(null);
      assert.deepStrictEqual(result2, {
        version: '',
        author: { name: '', email: '' },
        edits: []
      });

      const result3 = parseMarkdownEdits(undefined);
      assert.deepStrictEqual(result3, {
        version: '',
        author: { name: '', email: '' },
        edits: []
      });
    });

    it('should handle truncated output (partial recovery)', () => {
      const markdown = `
## Metadata

- **Version**: 0.1.0

## Edits Table

| Block | Op | Diff | Comment |
|-------|-----|------|---------|
| b001 | delete | - | Delete this |
| b002 | replace | true | Update this |
| b003 | replace | true | Truncated before newText

### b002 newText
This newText exists.
`;  // Output truncated - no newText for b003

      const result = parseMarkdownEdits(markdown);

      // Should recover what it can
      assert.strictEqual(result.version, '0.1.0');
      assert.strictEqual(result.edits.length, 3);
      assert.strictEqual(result.edits[0].operation, 'delete');
      assert.ok(result.edits[1].newText.includes('This newText exists.'));
      // b003 won't have newText because section was never started
      assert.strictEqual(result.edits[2].newText, undefined);
    });
  });
});

describe('editsToMarkdown', () => {
  it('should generate proper markdown structure', () => {
    const json = {
      version: '1.0.0',
      author: { name: 'Test Author', email: 'test@example.com' },
      edits: [
        { blockId: 'b001', operation: 'delete', comment: 'Remove this' }
      ]
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('# Edits'));
    assert.ok(markdown.includes('## Metadata'));
    assert.ok(markdown.includes('## Edits Table'));
    assert.ok(markdown.includes('| Block | Op | Diff | Comment |'));
    assert.ok(markdown.includes('|-------|-----|------|---------|'));
  });

  it('should include metadata section', () => {
    const json = {
      version: '2.0.0',
      author: { name: 'Jane Doe', email: 'jane@example.com' },
      edits: []
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('**Version**: 2.0.0'));
    assert.ok(markdown.includes('**Author Name**: Jane Doe'));
    assert.ok(markdown.includes('**Author Email**: jane@example.com'));
  });

  it('should generate edits table', () => {
    const json = {
      version: '',
      author: { name: '', email: '' },
      edits: [
        { blockId: 'b100', operation: 'delete', comment: 'Delete clause' },
        { blockId: 'b200', operation: 'comment', comment: 'Review this' }
      ]
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('| b100 | delete | - | Delete clause |'));
    assert.ok(markdown.includes('| b200 | comment | - | Review this |'));
  });

  it('should output newText sections for replace ops', () => {
    const json = {
      version: '',
      author: { name: '', email: '' },
      edits: [
        {
          blockId: 'b050',
          operation: 'replace',
          diff: true,
          comment: 'Update jurisdiction',
          newText: 'Business Day: a day in Singapore.'
        }
      ]
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('| b050 | replace | true | Update jurisdiction |'));
    assert.ok(markdown.includes('## Replacement Text'));
    assert.ok(markdown.includes('### b050 newText'));
    assert.ok(markdown.includes('Business Day: a day in Singapore.'));
  });

  it('should output insertText sections for insert ops', () => {
    const json = {
      version: '',
      author: { name: '', email: '' },
      edits: [
        {
          afterBlockId: 'b300',
          operation: 'insert',
          comment: 'Add new clause',
          text: 'The Buyer shall comply with all applicable laws.'
        }
      ]
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('| b300 | insert | - | Add new clause |'));
    assert.ok(markdown.includes('## Replacement Text'));
    assert.ok(markdown.includes('### b300 insertText'));
    assert.ok(markdown.includes('The Buyer shall comply with all applicable laws.'));
  });

  it('should round-trip JSON to Markdown to JSON', () => {
    const originalJson = {
      version: '0.2.0',
      author: { name: 'AI Counsel', email: 'ai@firm.com' },
      edits: [
        { blockId: 'b001', operation: 'delete', comment: 'Remove header' },
        {
          blockId: 'b002',
          operation: 'replace',
          diff: true,
          comment: 'Update clause',
          newText: 'Updated clause content here.'
        },
        { blockId: 'b003', operation: 'comment', comment: 'Please review' },
        {
          afterBlockId: 'b004',
          operation: 'insert',
          comment: 'Add section',
          text: 'New section content.'
        }
      ]
    };

    // Convert to markdown
    const markdown = editsToMarkdown(originalJson);

    // Parse back to JSON
    const parsedJson = parseMarkdownEdits(markdown);

    // Verify round-trip
    assert.strictEqual(parsedJson.version, originalJson.version);
    assert.strictEqual(parsedJson.author.name, originalJson.author.name);
    assert.strictEqual(parsedJson.author.email, originalJson.author.email);
    assert.strictEqual(parsedJson.edits.length, originalJson.edits.length);

    // Verify each edit
    // Delete
    assert.strictEqual(parsedJson.edits[0].blockId, 'b001');
    assert.strictEqual(parsedJson.edits[0].operation, 'delete');
    assert.strictEqual(parsedJson.edits[0].comment, 'Remove header');

    // Replace
    assert.strictEqual(parsedJson.edits[1].blockId, 'b002');
    assert.strictEqual(parsedJson.edits[1].operation, 'replace');
    assert.strictEqual(parsedJson.edits[1].diff, true);
    assert.strictEqual(parsedJson.edits[1].newText, 'Updated clause content here.');

    // Comment
    assert.strictEqual(parsedJson.edits[2].blockId, 'b003');
    assert.strictEqual(parsedJson.edits[2].operation, 'comment');

    // Insert
    assert.strictEqual(parsedJson.edits[3].afterBlockId, 'b004');
    assert.strictEqual(parsedJson.edits[3].operation, 'insert');
    assert.strictEqual(parsedJson.edits[3].text, 'New section content.');
  });

  it('should handle empty or invalid input', () => {
    assert.strictEqual(editsToMarkdown(null), '');
    assert.strictEqual(editsToMarkdown(undefined), '');
    assert.strictEqual(editsToMarkdown('not an object'), '');
  });

  it('should handle edits without comments', () => {
    const json = {
      version: '',
      author: { name: '', email: '' },
      edits: [
        { blockId: 'b001', operation: 'delete' }
      ]
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('| b001 | delete | - | - |'));
  });

  it('should handle replace with diff: false', () => {
    const json = {
      version: '',
      author: { name: '', email: '' },
      edits: [
        {
          blockId: 'b001',
          operation: 'replace',
          diff: false,
          newText: 'Full replacement'
        }
      ]
    };

    const markdown = editsToMarkdown(json);

    assert.ok(markdown.includes('| b001 | replace | false | - |'));
  });
});

describe('Regression: Content Omission Fix', () => {
  it('should not omit simple delete operations in large edit sets', () => {
    // Build a large edit set with many operations
    const edits = [];
    for (let i = 1; i <= 50; i++) {
      const blockId = `b${String(i).padStart(3, '0')}`;
      if (i % 5 === 0) {
        edits.push({ blockId, operation: 'delete', comment: `Delete block ${i}` });
      } else if (i % 3 === 0) {
        edits.push({
          blockId,
          operation: 'replace',
          diff: true,
          comment: `Replace block ${i}`,
          newText: `Replacement content for block ${i}`
        });
      } else {
        edits.push({ blockId, operation: 'comment', comment: `Comment on block ${i}` });
      }
    }

    const json = {
      version: '1.0.0',
      author: { name: 'Test', email: 'test@test.com' },
      edits
    };

    // Convert to markdown
    const markdown = editsToMarkdown(json);

    // Parse back
    const parsed = parseMarkdownEdits(markdown);

    // Verify all edits are preserved
    assert.strictEqual(parsed.edits.length, 50, 'All 50 edits should be preserved');

    // Count operations
    const deleteCount = parsed.edits.filter(e => e.operation === 'delete').length;
    const replaceCount = parsed.edits.filter(e => e.operation === 'replace').length;
    const commentCount = parsed.edits.filter(e => e.operation === 'comment').length;

    // Expected: 10 deletes (5, 10, 15, 20, 25, 30, 35, 40, 45, 50)
    // Expected: 13 replaces (3, 6, 9, 12, 18, 21, 24, 27, 33, 36, 39, 42, 48)
    // (excluding multiples of 5 which are deletes)
    // Expected: 27 comments (the rest)
    assert.strictEqual(deleteCount, 10, 'Should have 10 delete operations');
    assert.strictEqual(replaceCount, 13, 'Should have 13 replace operations');
    assert.strictEqual(commentCount, 27, 'Should have 27 comment operations');

    // Verify all delete operations are present and have correct block IDs
    const deleteEdits = parsed.edits.filter(e => e.operation === 'delete');
    const expectedDeleteBlockIds = ['b005', 'b010', 'b015', 'b020', 'b025', 'b030', 'b035', 'b040', 'b045', 'b050'];
    const actualDeleteBlockIds = deleteEdits.map(e => e.blockId).sort();
    assert.deepStrictEqual(actualDeleteBlockIds, expectedDeleteBlockIds, 'All delete block IDs should be correct');
  });
});
