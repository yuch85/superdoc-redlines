/**
 * Clause parsing and targeting module
 */

/**
 * Clause numbering patterns
 */
const CLAUSE_PATTERNS = {
  // Standard numbered: 1., 1.1, 1.1.1, 3.2.1 (with or without trailing period)
  numbered: /^(\d+(?:\.\d+)*)\.?\s+/,

  // Lettered: (a), (b), (c)
  lettered: /^\(([a-z])\)\s*/i,

  // Roman numerals: i., ii., iii.
  roman: /^([ivxlcdm]+)\.\s*/i,

  // Bracketed numbers: [1], [2]
  bracketed: /^\[(\d+)\]\s*/,

  // Article style: Article 1, Article I
  article: /^Article\s+(\d+|[IVXLCDM]+)/i,

  // Schedule/Exhibit: Schedule 1, Exhibit A
  schedule: /^(Schedule|Exhibit|Appendix|Annex)\s+(\d+|[A-Z])/i
};

/**
 * Represents a clause in the document structure
 */
export class Clause {
  constructor(options) {
    this.number = options.number;           // e.g., "3.2"
    this.heading = options.heading;         // e.g., "Warranties"
    this.level = options.level;             // Nesting depth
    this.startPos = options.startPos;       // ProseMirror start position
    this.endPos = options.endPos;           // ProseMirror end position (exclusive)
    this.text = options.text;               // Full clause text
    this.children = [];                     // Sub-clauses
    this.parent = null;                     // Parent clause
  }

  get fullNumber() {
    if (this.parent) {
      return `${this.parent.fullNumber}.${this.number}`;
    }
    return this.number;
  }
}

/**
 * Parse clause number from paragraph text
 *
 * @param {string} text - Paragraph text
 * @returns {{ type: string, number: string, remainder: string } | null}
 */
export function parseClauseNumber(text) {
  text = text.trim();

  for (const [type, pattern] of Object.entries(CLAUSE_PATTERNS)) {
    const match = pattern.exec(text);
    if (match) {
      return {
        type,
        number: match[1],
        remainder: text.slice(match[0].length).trim()
      };
    }
  }

  return null;
}

/**
 * Determine if a paragraph is a heading based on style or content
 *
 * @param {Object} node - ProseMirror paragraph node
 * @param {string} text - Paragraph text
 * @returns {{ isHeading: boolean, level: number, title: string }}
 */
export function analyzeHeading(node, text) {
  // Check for Heading style marks/attributes
  const style = node.attrs?.style || '';
  const headingMatch = style.match(/Heading\s*(\d+)/i);

  if (headingMatch) {
    return {
      isHeading: true,
      level: parseInt(headingMatch[1], 10),
      title: text.trim()
    };
  }

  // Heuristic: ALL CAPS short text is likely a heading
  if (text.length < 100 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return {
      isHeading: true,
      level: 1,  // Assume top-level
      title: text.trim()
    };
  }

  return { isHeading: false, level: 0, title: '' };
}

/**
 * Build clause structure from ProseMirror document
 *
 * @param {Object} doc - ProseMirror document
 * @returns {{ clauses: Clause[], index: Map<string, Clause> }}
 */
export function buildClauseStructure(doc) {
  const clauses = [];
  const index = new Map();  // Quick lookup by number or heading
  const stack = [];         // Stack for building hierarchy

  doc.forEach((node, offset) => {
    const nodeStart = offset;
    const nodeEnd = offset + node.nodeSize;

    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      const text = node.textContent;
      const parsed = parseClauseNumber(text);
      const headingInfo = analyzeHeading(node, text);

      if (parsed || headingInfo.isHeading) {
        // Determine clause level
        let level = 1;
        if (parsed) {
          // Count dots in number for level: "3.2.1" = level 3
          level = (parsed.number.match(/\./g) || []).length + 1;
        } else if (headingInfo.isHeading) {
          level = headingInfo.level;
        }

        // Create clause
        const clause = new Clause({
          number: parsed?.number || null,
          heading: headingInfo.title || parsed?.remainder?.split('\n')[0] || null,
          level,
          startPos: nodeStart,
          endPos: nodeEnd,  // Will be updated when next clause found
          text: text
        });

        // Update parent's end position
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          const popped = stack.pop();
          popped.endPos = nodeStart;
        }

        // Set parent relationship
        if (stack.length > 0) {
          clause.parent = stack[stack.length - 1];
          stack[stack.length - 1].children.push(clause);
        } else {
          clauses.push(clause);
        }

        stack.push(clause);

        // Index by number and heading
        if (clause.number) {
          index.set(clause.number, clause);
          index.set(clause.fullNumber, clause);
        }
        if (clause.heading) {
          index.set(clause.heading.toLowerCase(), clause);
        }
      }
    }
  });

  // Finalize end positions for remaining stack items
  const docEnd = doc.content.size;
  while (stack.length > 0) {
    stack.pop().endPos = docEnd;
  }

  return { clauses, index };
}

/**
 * Find a clause by number or heading
 *
 * @param {Map<string, Clause>} index - Clause index
 * @param {Object} query - Query parameters
 * @param {string} [query.number] - Clause number (e.g., "3.2")
 * @param {string} [query.heading] - Clause heading (e.g., "Definitions")
 * @returns {Clause | null}
 */
export function findClause(index, query) {
  if (query.number) {
    return index.get(query.number) || null;
  }

  if (query.heading) {
    // Try exact match first
    const exactKey = query.heading.toLowerCase();
    if (index.has(exactKey)) {
      return index.get(exactKey);
    }

    // Try fuzzy heading match
    for (const [key, clause] of index) {
      if (typeof key === 'string' && key.toLowerCase().includes(exactKey)) {
        return clause;
      }
    }
  }

  return null;
}

/**
 * Get the full range of a clause including its sub-clauses
 *
 * @param {Clause} clause
 * @param {boolean} includeSubclauses - Whether to include nested clauses
 * @returns {{ from: number, to: number }}
 */
export function getClauseRange(clause, includeSubclauses = true) {
  if (includeSubclauses) {
    return { from: clause.startPos, to: clause.endPos };
  }

  // Find end before first child
  if (clause.children.length > 0) {
    return { from: clause.startPos, to: clause.children[0].startPos };
  }

  return { from: clause.startPos, to: clause.endPos };
}

/**
 * Extract clause text from document
 *
 * @param {Object} doc - ProseMirror document
 * @param {Clause} clause
 * @param {boolean} includeSubclauses
 * @returns {string}
 */
export function extractClauseText(doc, clause, includeSubclauses = true) {
  const { from, to } = getClauseRange(clause, includeSubclauses);
  return doc.textBetween(from, to, '\n');
}
