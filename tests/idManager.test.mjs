/**
 * Tests for IdManager - dual UUID + sequential ID system
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IdManager, createIdManager } from '../src/idManager.mjs';

describe('IdManager', () => {
  let manager;

  beforeEach(() => {
    manager = createIdManager();
  });

  describe('generateId', () => {
    it('generates unique UUIDs', () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();
      assert.notEqual(id1.uuid, id2.uuid);
    });

    it('generates sequential seqIds starting at b001', () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();
      const id3 = manager.generateId();

      assert.equal(id1.seqId, 'b001');
      assert.equal(id2.seqId, 'b002');
      assert.equal(id3.seqId, 'b003');
    });

    it('returns object with uuid and seqId properties', () => {
      const id = manager.generateId();
      assert.ok(id.uuid);
      assert.ok(id.seqId);
      assert.match(id.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.match(id.seqId, /^b\d{3,}$/);
    });

    it('stores mapping in both directions', () => {
      const id = manager.generateId();
      assert.equal(manager.getSeqId(id.uuid), id.seqId);
      assert.equal(manager.getUuid(id.seqId), id.uuid);
    });
  });

  describe('registerExistingId', () => {
    it('registers existing UUIDs with new seqId', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const seqId = manager.registerExistingId(uuid);

      assert.equal(seqId, 'b001');
      assert.equal(manager.getSeqId(uuid), 'b001');
      assert.equal(manager.getUuid('b001'), uuid);
    });

    it('returns existing seqId for already registered UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const seqId1 = manager.registerExistingId(uuid);
      const seqId2 = manager.registerExistingId(uuid);

      assert.equal(seqId1, seqId2);
      assert.equal(manager.count, 1);  // Should not double-count
    });

    it('assigns sequential IDs in order of registration', () => {
      const uuid1 = '550e8400-e29b-41d4-a716-446655440001';
      const uuid2 = '550e8400-e29b-41d4-a716-446655440002';
      const uuid3 = '550e8400-e29b-41d4-a716-446655440003';

      assert.equal(manager.registerExistingId(uuid1), 'b001');
      assert.equal(manager.registerExistingId(uuid2), 'b002');
      assert.equal(manager.registerExistingId(uuid3), 'b003');
    });
  });

  describe('getSeqId', () => {
    it('returns seqId for known UUID', () => {
      const id = manager.generateId();
      assert.equal(manager.getSeqId(id.uuid), id.seqId);
    });

    it('returns null for unknown UUID', () => {
      assert.equal(manager.getSeqId('unknown-uuid'), null);
    });
  });

  describe('getUuid', () => {
    it('returns UUID for known seqId', () => {
      const id = manager.generateId();
      assert.equal(manager.getUuid(id.seqId), id.uuid);
    });

    it('returns null for unknown seqId', () => {
      assert.equal(manager.getUuid('b999'), null);
    });
  });

  describe('resolveToUuid', () => {
    it('resolves seqId format to UUID', () => {
      const id = manager.generateId();
      assert.equal(manager.resolveToUuid(id.seqId), id.uuid);
    });

    it('returns UUID directly if already a UUID', () => {
      const id = manager.generateId();
      assert.equal(manager.resolveToUuid(id.uuid), id.uuid);
    });

    it('returns null for unknown seqId', () => {
      assert.equal(manager.resolveToUuid('b999'), null);
    });

    it('returns null for unknown UUID', () => {
      assert.equal(manager.resolveToUuid('00000000-0000-0000-0000-000000000000'), null);
    });
  });

  describe('formatSeqId', () => {
    it('pads single digits to 3 places', () => {
      assert.equal(manager.formatSeqId(1), 'b001');
      assert.equal(manager.formatSeqId(9), 'b009');
    });

    it('pads double digits to 3 places', () => {
      assert.equal(manager.formatSeqId(10), 'b010');
      assert.equal(manager.formatSeqId(99), 'b099');
    });

    it('handles triple digits without padding', () => {
      assert.equal(manager.formatSeqId(100), 'b100');
      assert.equal(manager.formatSeqId(999), 'b999');
    });

    it('handles numbers larger than 999', () => {
      assert.equal(manager.formatSeqId(1000), 'b1000');
      assert.equal(manager.formatSeqId(9999), 'b9999');
    });
  });

  describe('count', () => {
    it('returns 0 for new manager', () => {
      assert.equal(manager.count, 0);
    });

    it('increments with generateId', () => {
      manager.generateId();
      assert.equal(manager.count, 1);
      manager.generateId();
      assert.equal(manager.count, 2);
    });

    it('increments with registerExistingId', () => {
      manager.registerExistingId('uuid-1');
      assert.equal(manager.count, 1);
      manager.registerExistingId('uuid-2');
      assert.equal(manager.count, 2);
    });
  });

  describe('exportMapping', () => {
    it('exports empty object for new manager', () => {
      const mapping = manager.exportMapping();
      assert.deepEqual(mapping, {});
    });

    it('exports uuid -> seqId mapping', () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();

      const mapping = manager.exportMapping();

      assert.equal(mapping[id1.uuid], 'b001');
      assert.equal(mapping[id2.uuid], 'b002');
      assert.equal(Object.keys(mapping).length, 2);
    });
  });

  describe('importMapping', () => {
    it('imports uuid -> seqId mapping', () => {
      const mapping = {
        'uuid-a': 'b001',
        'uuid-b': 'b002'
      };

      manager.importMapping(mapping);

      assert.equal(manager.getSeqId('uuid-a'), 'b001');
      assert.equal(manager.getSeqId('uuid-b'), 'b002');
      assert.equal(manager.getUuid('b001'), 'uuid-a');
      assert.equal(manager.getUuid('b002'), 'uuid-b');
    });

    it('updates counter to avoid collisions', () => {
      const mapping = {
        'uuid-a': 'b005',
        'uuid-b': 'b010'
      };

      manager.importMapping(mapping);

      // Counter should be at 10, so next ID is b011
      const newId = manager.generateId();
      assert.equal(newId.seqId, 'b011');
    });

    it('preserves existing mappings when importing', () => {
      manager.generateId();  // b001

      manager.importMapping({
        'imported-uuid': 'b050'
      });

      // Original mapping should still exist
      assert.equal(manager.count, 50);  // Counter updated to 50
    });
  });

  describe('clear', () => {
    it('clears all mappings', () => {
      manager.generateId();
      manager.generateId();

      manager.clear();

      assert.equal(manager.count, 0);
      assert.deepEqual(manager.exportMapping(), {});
    });

    it('resets counter so new IDs start at b001', () => {
      manager.generateId();
      manager.generateId();
      manager.clear();

      const newId = manager.generateId();
      assert.equal(newId.seqId, 'b001');
    });
  });

  describe('createIdManager factory', () => {
    it('creates new IdManager instance', () => {
      const manager1 = createIdManager();
      const manager2 = createIdManager();

      assert.ok(manager1 instanceof IdManager);
      assert.ok(manager2 instanceof IdManager);
      assert.notEqual(manager1, manager2);
    });
  });
});
