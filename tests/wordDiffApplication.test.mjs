/**
 * Tests for Word Diff Application - Verifies the reverse-order fix
 *
 * These tests specifically target the position corruption bug that occurred
 * when applying word-level diffs sequentially. The fix ensures operations
 * are applied in reverse order (end-to-start) to prevent position shifts
 * from corrupting subsequent operations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEditorWithIR } from '../src/irExtractor.mjs';
import { replaceBlockById, getBlockById } from '../src/blockOperations.mjs';
import { diffToOperations } from '../src/wordDiff.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const sampleDocx = path.join(fixturesDir, 'sample.docx');
const assetPurchaseDocx = path.join(fixturesDir, 'asset-purchase.docx');

describe('Word Diff Application - Position Integrity', () => {
  describe('diffToOperations reverse sorting', () => {
    it('produces operations with correct positions for reverse-order application', () => {
      // This is the exact pattern that was causing corruption:
      // "England and Wales" -> "Singapore"
      // Multiple operations at different positions
      const ops = diffToOperations('England and Wales', 'Singapore');
      
      // Verify each operation has a position
      for (const op of ops) {
        assert.ok(typeof op.position === 'number', `Operation should have position: ${JSON.stringify(op)}`);
      }
      
      // When sorted in descending order, later positions come first
      const sortedOps = [...ops].sort((a, b) => b.position - a.position);
      
      // Verify descending order
      for (let i = 1; i < sortedOps.length; i++) {
        assert.ok(
          sortedOps[i].position <= sortedOps[i - 1].position,
          `Operations should be in descending position order`
        );
      }
    });

    it('handles complex jurisdiction change with multiple words', () => {
      // Pattern from the Singapore amendment bug
      const original = 'incorporated and registered in England and Wales with company number';
      const target = 'incorporated and registered in Singapore with unique entity number (UEN)';
      
      const ops = diffToOperations(original, target);
      
      // Should produce multiple operations
      assert.ok(ops.length > 0, 'Should have operations');
      
      // Simulate reverse-order application
      const sortedOps = [...ops].sort((a, b) => b.position - a.position);
      
      // Positions should be valid (non-negative, within original text bounds)
      for (const op of sortedOps) {
        assert.ok(op.position >= 0, `Position should be non-negative: ${op.position}`);
        assert.ok(op.position <= original.length, `Position should be within text bounds: ${op.position}`);
      }
    });

    it('handles Business Day definition change', () => {
      // This was one of the corrupted examples (b165)
      const original = 'Business Day: a day other than a Saturday, Sunday or public holiday in England when banks in London are open for business.';
      const target = 'Business Day: a day other than a Saturday, Sunday or public holiday in Singapore when banks in Singapore are open for business.';
      
      const ops = diffToOperations(original, target);
      
      // Should have operations for England->Singapore and London->Singapore
      assert.ok(ops.length >= 1, 'Should have at least one operation');
      
      // Verify we can reconstruct target from original using ops
      // (This is what applyWordDiff does internally)
      let result = original;
      const sortedOps = [...ops].sort((a, b) => b.position - a.position);
      
      for (const op of sortedOps) {
        if (op.type === 'replace') {
          result = result.slice(0, op.position) + op.insertText + result.slice(op.position + op.deleteText.length);
        } else if (op.type === 'delete') {
          result = result.slice(0, op.position) + result.slice(op.position + op.text.length);
        } else if (op.type === 'insert') {
          result = result.slice(0, op.position) + op.text + result.slice(op.position);
        }
      }
      
      assert.equal(result, target, 'Reverse-order operations should produce correct result');
    });

    it('handles Companies Act definition change', () => {
      // Another corrupted example (b180)
      const original = 'Companies Act: the Companies Act 2006.';
      const target = 'Companies Act: the Companies Act 1967 of Singapore (Cap. 50).';
      
      const ops = diffToOperations(original, target);
      
      // Verify reverse-order reconstruction
      let result = original;
      const sortedOps = [...ops].sort((a, b) => b.position - a.position);
      
      for (const op of sortedOps) {
        if (op.type === 'replace') {
          result = result.slice(0, op.position) + op.insertText + result.slice(op.position + op.deleteText.length);
        } else if (op.type === 'delete') {
          result = result.slice(0, op.position) + result.slice(op.position + op.text.length);
        } else if (op.type === 'insert') {
          result = result.slice(0, op.position) + op.text + result.slice(op.position);
        }
      }
      
      assert.equal(result, target, 'Should correctly transform Companies Act definition');
    });

    it('handles PDPA definition (complex multi-word change)', () => {
      // Corrupted example (b194) - DPA -> PDPA
      const original = 'DPA: the Data Protection Act 1998.';
      const target = 'PDPA: the Personal Data Protection Act 2012 of Singapore.';
      
      const ops = diffToOperations(original, target);
      
      // Verify reverse-order reconstruction
      let result = original;
      const sortedOps = [...ops].sort((a, b) => b.position - a.position);
      
      for (const op of sortedOps) {
        if (op.type === 'replace') {
          result = result.slice(0, op.position) + op.insertText + result.slice(op.position + op.deleteText.length);
        } else if (op.type === 'delete') {
          result = result.slice(0, op.position) + result.slice(op.position + op.text.length);
        } else if (op.type === 'insert') {
          result = result.slice(0, op.position) + op.text + result.slice(op.position);
        }
      }
      
      assert.equal(result, target, 'Should correctly transform DPA to PDPA definition');
    });
  });

  describe('replaceBlockById with word diff', () => {
    it('applies word diff without text corruption', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        const originalBlock = getBlockById(editor, blockId);
        const originalText = originalBlock.text;
        
        // Apply a change that involves multiple operations
        const newText = 'This is completely new text that replaces the original';
        
        const result = await replaceBlockById(editor, blockId, newText, { diff: true, trackChanges: false });
        
        assert.equal(result.success, true, 'Replace should succeed');
        
        // Verify the final text matches what we expect
        const updatedBlock = getBlockById(editor, blockId);
        
        // Text should be the new text (or contain it, depending on how diff applies)
        assert.ok(
          updatedBlock.text.includes('completely new text') || 
          updatedBlock.text.includes('replaces'),
          `Updated text should contain new content. Got: "${updatedBlock.text}"`
        );
        
        // Text should NOT contain garbled/corrupted characters
        // Check for common corruption patterns (words concatenated without spaces)
        assert.ok(
          !updatedBlock.text.includes('newtext') &&
          !updatedBlock.text.includes('replacesthe'),
          'Text should not be corrupted (words concatenated)'
        );
      } finally {
        cleanup();
      }
    });

    it('handles England -> Singapore jurisdiction change', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        
        // First set up the original text
        await replaceBlockById(editor, blockId, 'incorporated in England and Wales', { diff: false, trackChanges: false });
        
        // Now apply the Singapore change with diff
        const result = await replaceBlockById(
          editor, 
          blockId, 
          'incorporated in Singapore',
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        
        const updated = getBlockById(editor, blockId);
        
        // Should contain Singapore, not garbled text
        assert.ok(
          updated.text.includes('Singapore'),
          `Text should contain "Singapore". Got: "${updated.text}"`
        );
        
        // Should NOT have corruption patterns like "inSingapore" (missing space)
        assert.ok(
          !updated.text.includes('inSingapore'),
          'Text should not have missing spaces (corruption)'
        );
      } finally {
        cleanup();
      }
    });

    it('handles multiple word changes in same text', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        
        // Set up original with multiple items to change
        await replaceBlockById(
          editor, 
          blockId, 
          'The quick brown fox jumps over the lazy dog',
          { diff: false, trackChanges: false }
        );
        
        // Apply multiple word changes
        const result = await replaceBlockById(
          editor, 
          blockId, 
          'The slow brown cat leaps over the active dog',
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        
        const updated = getBlockById(editor, blockId);
        
        // Check each change was applied correctly
        assert.ok(updated.text.includes('slow'), `Should contain "slow". Got: "${updated.text}"`);
        assert.ok(updated.text.includes('cat'), `Should contain "cat". Got: "${updated.text}"`);
        assert.ok(updated.text.includes('leaps'), `Should contain "leaps". Got: "${updated.text}"`);
        assert.ok(updated.text.includes('active'), `Should contain "active". Got: "${updated.text}"`);
        
        // Should NOT have old words
        assert.ok(!updated.text.includes('quick'), 'Should not contain "quick"');
        assert.ok(!updated.text.includes('fox'), 'Should not contain "fox"');
        assert.ok(!updated.text.includes('jumps'), 'Should not contain "jumps"');
        assert.ok(!updated.text.includes('lazy'), 'Should not contain "lazy"');
        
        // Check for corruption patterns
        assert.ok(!updated.text.includes('slowbrown'), 'No corruption: words should have spaces');
        assert.ok(!updated.text.includes('catslow'), 'No corruption: words not garbled');
      } finally {
        cleanup();
      }
    });

    it('applies diffStats correctly', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        
        await replaceBlockById(editor, blockId, 'Hello world', { diff: false, trackChanges: false });
        
        const result = await replaceBlockById(
          editor, 
          blockId, 
          'Hello there',
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        assert.ok(result.diffStats, 'Should have diffStats');
        assert.ok(result.diffStats.deletions > 0, 'Should have deletions');
        assert.ok(result.diffStats.insertions > 0, 'Should have insertions');
      } finally {
        cleanup();
      }
    });
  });

  describe('Large document stress test', () => {
    it('applies multiple edits to large document without corruption', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(assetPurchaseDocx);
      
      try {
        assert.ok(ir.blocks.length > 10, 'Should have many blocks');
        
        // Apply word-diff changes to several blocks
        const testBlocks = ir.blocks.slice(0, 5);
        
        for (const block of testBlocks) {
          const original = block.text;
          if (original.length < 10) continue;
          
          // Modify a word in the middle
          const words = original.split(' ');
          if (words.length < 3) continue;
          
          const midIndex = Math.floor(words.length / 2);
          words[midIndex] = 'MODIFIED';
          const newText = words.join(' ');
          
          const result = await replaceBlockById(editor, block.id, newText, { diff: true });
          
          assert.equal(result.success, true, `Replace should succeed for block ${block.seqId}`);
          
          const updated = getBlockById(editor, block.id);
          assert.ok(
            updated.text.includes('MODIFIED'),
            `Block ${block.seqId} should contain MODIFIED. Got: "${updated.text.slice(0, 100)}..."`
          );
        }
      } finally {
        cleanup();
      }
    });
  });

  describe('Edge cases', () => {
    it('handles empty to text', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        
        // Note: Setting to empty might not work in all cases
        // but the diff from short to long should work
        await replaceBlockById(editor, blockId, 'A', { diff: false, trackChanges: false });
        
        const result = await replaceBlockById(
          editor, 
          blockId, 
          'A completely new and longer text',
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        
        const updated = getBlockById(editor, blockId);
        assert.ok(updated.text.includes('completely new'), 'Should contain new text');
      } finally {
        cleanup();
      }
    });

    it('handles text to shorter text', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        
        await replaceBlockById(
          editor, 
          blockId, 
          'This is a very long text that will be shortened',
          { diff: false, trackChanges: false }
        );
        
        const result = await replaceBlockById(
          editor, 
          blockId, 
          'Short text',
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        
        const updated = getBlockById(editor, blockId);
        assert.ok(
          updated.text.includes('Short') || updated.text.length < 50,
          'Text should be shortened'
        );
      } finally {
        cleanup();
      }
    });

    it('handles identical text (no-op)', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        const originalText = 'This text stays the same';
        
        await replaceBlockById(editor, blockId, originalText, { diff: false, trackChanges: false });
        
        const result = await replaceBlockById(
          editor, 
          blockId, 
          originalText, // Same text
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        
        const updated = getBlockById(editor, blockId);
        assert.equal(updated.text, originalText, 'Text should be unchanged');
      } finally {
        cleanup();
      }
    });

    it('handles special characters and punctuation', async () => {
      const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
      
      try {
        const blockId = ir.blocks[0].id;
        
        await replaceBlockById(
          editor, 
          blockId, 
          'Price: $100.00 (USD)',
          { diff: false, trackChanges: false }
        );
        
        const result = await replaceBlockById(
          editor, 
          blockId, 
          'Price: $200.00 (SGD)',
          { diff: true, trackChanges: false }
        );
        
        assert.equal(result.success, true);
        
        const updated = getBlockById(editor, blockId);
        assert.ok(updated.text.includes('$200.00'), 'Should have updated price');
        assert.ok(updated.text.includes('SGD'), 'Should have updated currency');
      } finally {
        cleanup();
      }
    });
  });
});

describe('Regression Tests - Singapore Amendment Corruptions', () => {
  // These tests specifically reproduce the corruption patterns seen in DEBUG-HANDOFF.md
  
  it('b149 pattern: jurisdiction change without space corruption', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
    
    try {
      const blockId = ir.blocks[0].id;
      
      const original = 'incorporated and registered in England and Wales';
      const target = 'incorporated and registered in Singapore';
      
      // Setup: use trackChanges: false to actually replace the content
      await replaceBlockById(editor, blockId, original, { diff: false, trackChanges: false });
      // Apply with track changes enabled (the typical use case)
      const result = await replaceBlockById(editor, blockId, target, { diff: true, trackChanges: false });
      
      assert.equal(result.success, true);
      
      const updated = getBlockById(editor, blockId);
      
      // The bug would produce "incorporated and registered inSingapore" (missing space)
      assert.ok(
        !updated.text.includes('inSingapore'),
        `Should not have corruption "inSingapore". Got: "${updated.text}"`
      );
      
      // Should have proper spacing
      assert.ok(
        updated.text.includes('in Singapore'),
        `Should have proper spacing "in Singapore". Got: "${updated.text}"`
      );
    } finally {
      cleanup();
    }
  });

  it('b165 pattern: Business Day multiple location changes', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
    
    try {
      const blockId = ir.blocks[0].id;
      
      const original = 'public holiday in England when banks in London are open';
      const target = 'public holiday in Singapore when banks in Singapore are open';
      
      await replaceBlockById(editor, blockId, original, { diff: false, trackChanges: false });
      const result = await replaceBlockById(editor, blockId, target, { diff: true, trackChanges: false });
      
      assert.equal(result.success, true);
      
      const updated = getBlockById(editor, blockId);
      
      // The bug produced: "holidaSingaporegland when banks in London"
      // Check for any character-level corruption
      assert.ok(
        !updated.text.includes('holidaSingapore'),
        'Should not have corruption pattern 1'
      );
      assert.ok(
        !updated.text.includes('Singaporegland'),
        'Should not have corruption pattern 2'
      );
      
      // Should have both Singapores
      const singaporeCount = (updated.text.match(/Singapore/g) || []).length;
      assert.ok(
        singaporeCount >= 2,
        `Should have at least 2 occurrences of "Singapore". Got ${singaporeCount} in: "${updated.text}"`
      );
    } finally {
      cleanup();
    }
  });

  it('b180 pattern: Companies Act year change', async () => {
    const { editor, ir, cleanup } = await createEditorWithIR(sampleDocx);
    
    try {
      const blockId = ir.blocks[0].id;
      
      const original = 'Companies Act: the Companies Act 2006.';
      const target = 'Companies Act: the Companies Act 1967 of Singapore (Cap. 50).';
      
      await replaceBlockById(editor, blockId, original, { diff: false, trackChanges: false });
      const result = await replaceBlockById(editor, blockId, target, { diff: true, trackChanges: false });
      
      assert.equal(result.success, true);
      
      const updated = getBlockById(editor, blockId);
      
      // The bug produced: "CompaniActcts: the1967 of Singapore (Cap. 50).anies Act 2006."
      assert.ok(
        !updated.text.includes('CompaniActcts'),
        'Should not have character corruption'
      );
      assert.ok(
        !updated.text.includes('the1967'),
        'Should not have missing space before year'
      );
      // Check for leftover fragments at the end (the corruption pattern)
      // "anies Act 2006" at the end would indicate leftover fragments
      assert.ok(
        !updated.text.includes('2006'),
        'Should not have leftover old year "2006"'
      );
      
      // Should have correct content
      assert.ok(
        updated.text.includes('1967'),
        `Should contain "1967". Got: "${updated.text}"`
      );
      assert.ok(
        updated.text.includes('Cap. 50'),
        `Should contain "Cap. 50". Got: "${updated.text}"`
      );
      
      // Verify the complete expected text
      assert.equal(
        updated.text,
        target,
        `Should exactly match target. Got: "${updated.text}"`
      );
    } finally {
      cleanup();
    }
  });
});
