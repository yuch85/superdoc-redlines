/**
 * ID Manager for dual UUID + sequential ID system.
 *
 * UUIDs (sdBlockId) are SuperDoc's native identifiers - guaranteed unique, persist through export/import.
 * Sequential IDs (seqId) are human-readable (e.g., "b001", "b002") - easier for LLMs to reference.
 */
export class IdManager {
  constructor() {
    this.uuidToSeq = new Map();  // UUID -> seqId
    this.seqToUuid = new Map();  // seqId -> UUID
    this.counter = 0;
  }

  /**
   * Generate a new dual ID pair.
   * @returns {{ uuid: string, seqId: string }}
   */
  generateId() {
    const uuid = crypto.randomUUID();
    const seqId = this.formatSeqId(++this.counter);

    this.uuidToSeq.set(uuid, seqId);
    this.seqToUuid.set(seqId, uuid);

    return { uuid, seqId };
  }

  /**
   * Register an existing UUID (from a previously structured document).
   * Assigns a new sequential ID.
   *
   * @param {string} uuid - Existing UUID
   * @returns {string} - Assigned seqId
   */
  registerExistingId(uuid) {
    if (this.uuidToSeq.has(uuid)) {
      return this.uuidToSeq.get(uuid);
    }

    const seqId = this.formatSeqId(++this.counter);
    this.uuidToSeq.set(uuid, seqId);
    this.seqToUuid.set(seqId, uuid);

    return seqId;
  }

  /**
   * Get sequential ID for a UUID.
   * @param {string} uuid
   * @returns {string|null}
   */
  getSeqId(uuid) {
    return this.uuidToSeq.get(uuid) || null;
  }

  /**
   * Get UUID for a sequential ID.
   * @param {string} seqId
   * @returns {string|null}
   */
  getUuid(seqId) {
    return this.seqToUuid.get(seqId) || null;
  }

  /**
   * Resolve a block ID that could be either UUID or seqId format.
   * @param {string} id - Either UUID or seqId (e.g., "b025")
   * @returns {string|null} - The UUID
   */
  resolveToUuid(id) {
    // Check if it's a seqId format (e.g., "b001", "b025")
    if (/^b\d+$/.test(id)) {
      return this.getUuid(id);
    }
    // Assume it's already a UUID
    if (this.uuidToSeq.has(id)) {
      return id;
    }
    return null;
  }

  /**
   * Format counter as sequential ID.
   * @param {number} n
   * @returns {string} - e.g., "b001", "b042", "b999"
   */
  formatSeqId(n) {
    return 'b' + n.toString().padStart(3, '0');
  }

  /**
   * Get the current count of registered IDs.
   * @returns {number}
   */
  get count() {
    return this.counter;
  }

  /**
   * Export ID mapping for inclusion in IR.
   * @returns {Object}
   */
  exportMapping() {
    return Object.fromEntries(this.uuidToSeq);
  }

  /**
   * Import ID mapping from existing IR.
   * @param {Object} mapping - Object with uuid keys and seqId values
   */
  importMapping(mapping) {
    for (const [uuid, seqId] of Object.entries(mapping)) {
      this.uuidToSeq.set(uuid, seqId);
      this.seqToUuid.set(seqId, uuid);

      // Update counter to avoid collisions
      const num = parseInt(seqId.slice(1), 10);
      if (num >= this.counter) {
        this.counter = num;
      }
    }
  }

  /**
   * Clear all ID mappings.
   */
  clear() {
    this.uuidToSeq.clear();
    this.seqToUuid.clear();
    this.counter = 0;
  }
}

/**
 * Create a new ID manager instance.
 * @returns {IdManager}
 */
export function createIdManager() {
  return new IdManager();
}
