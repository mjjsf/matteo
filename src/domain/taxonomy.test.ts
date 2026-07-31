import { describe, expect, it } from 'vitest';
import { loadSeedCorpus, loadTagMap, loadTaxonomyFile } from './fixtures';
import {
  buildTaxonomyIndex,
  isLeaf,
  leafIds,
  nodesForBook,
  nodesWithAncestorsForBook,
  populateMembers,
  primaryRootForBook,
  validateStructure,
} from './taxonomy';

const file = loadTaxonomyFile();
const tagMap = loadTagMap();
const books = loadSeedCorpus();
const index = populateMembers(buildTaxonomyIndex(file), books, tagMap);

describe('taxonomy structure', () => {
  it('is structurally sound: parents resolve, nothing unreachable, no cycles', () => {
    expect(validateStructure(index)).toEqual([]);
  });

  it('has unique node ids', () => {
    // buildTaxonomyIndex throws on duplicates, so reaching here proves it, but
    // assert the count too so a silent change in that behaviour is caught.
    const ids = [...index.byId.keys()];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the root count reviewable', () => {
    // This was a hard cap of 8, justified by colour: no palette keeps more than
    // a handful of categorical hues distinguishable. That reason is gone —
    // nothing has been coloured by branch since the whole-corpus cloud was
    // replaced by a graph grown from one book, where hue encodes whether a node
    // can still be opened. The cap now exists only to keep the top level
    // something a person can hold in their head, so it is loose and the number
    // carries no rendering consequence.
    expect(index.rootIds.length).toBeLessThanOrEqual(12);
  });

  it('stays shallow enough to read, without capping the depth the code accepts', () => {
    // Raised from 2 when `philosophy-western-continental` gained a level. The
    // limit is editorial, not structural: `buildTaxonomyIndex` recurses to any
    // depth and nothing downstream assumes a maximum, so this exists to catch a
    // taxonomy that has quietly become a filing system nobody can hold in their
    // head — not to stop the tree growing.
    expect(index.maxDepth).toBeLessThanOrEqual(4);
  });

  it('reads a tree deeper than the authored one', () => {
    // The guard for the claim above. If someone reintroduces a depth assumption,
    // this fails rather than the corpus silently losing its deepest level.
    const deep = buildTaxonomyIndex({
      version: 1,
      roots: [
        {
          id: 'a',
          label: 'A',
          children: [
            { id: 'b', label: 'B', children: [{ id: 'c', label: 'C', children: [{ id: 'd', label: 'D' }] }] },
          ],
        },
      ],
    });
    expect(deep.maxDepth).toBe(3);
    expect(deep.ancestorsOf.get('d')).toEqual(['c', 'b', 'a']);
    expect(deep.byId.get('d')?.rootId).toBe('a');
  });

  it('gives every node a rootId that is actually a root', () => {
    for (const node of index.byId.values()) {
      expect(index.rootIds).toContain(node.rootId);
    }
  });

  it('records ancestors nearest-first', () => {
    const leaf = [...index.byId.values()].find((n) => n.depth === 2);
    expect(leaf).toBeDefined();
    const ancestors = index.ancestorsOf.get((leaf as { id: string }).id) ?? [];
    expect(ancestors).toHaveLength(2);
    expect(index.byId.get(ancestors[0] as string)?.depth).toBe(1);
    expect(index.byId.get(ancestors[1] as string)?.depth).toBe(0);
  });
});

describe('tagMap coverage', () => {
  it('only targets taxonomy nodes that exist', () => {
    const bad: string[] = [];
    for (const [tag, nodeIds] of Object.entries(tagMap)) {
      for (const nodeId of nodeIds) {
        if (!index.byId.has(nodeId)) bad.push(`${tag} -> ${nodeId}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives every taxonomy leaf at least one tag that reaches it', () => {
    const targeted = new Set(Object.values(tagMap).flat());
    const orphanLeaves = leafIds(index).filter((id) => !targeted.has(id));
    expect(orphanLeaves).toEqual([]);
  });

  it('leaves no node without members', () => {
    // An empty taxonomy node would render as a labelled sphere representing
    // nothing, which is worse than omitting the category.
    const empty = [...index.byId.values()]
      .filter((n) => (index.membersOf.get(n.id)?.size ?? 0) === 0)
      .map((n) => n.id);
    expect(empty).toEqual([]);
  });
});

describe('book -> node resolution', () => {
  const sample = books.find((b) => b.id === 'neuromancer');

  it('resolves a known book to its leaves', () => {
    expect(sample).toBeDefined();
    const nodes = nodesForBook(sample!, tagMap);
    expect(nodes).toContain('spec-sf-cyberpunk');
    expect(nodes).toContain('science-computing-ai');
  });

  it('includes ancestors when asked', () => {
    const withAncestors = nodesWithAncestorsForBook(sample!, tagMap, index);
    expect(withAncestors).toContain('spec-sf-cyberpunk');
    expect(withAncestors).toContain('spec-sf');
    expect(withAncestors).toContain('spec');
  });

  it('skips unknown tags instead of throwing', () => {
    const nodes = nodesForBook(
      { ...sample!, subjects: ['definitely-not-a-tag'] },
      tagMap,
    );
    expect(nodes).toEqual([]);
  });

  it('assigns every book a primary root', () => {
    const unassigned = books.filter((b) => primaryRootForBook(b, tagMap, index) === null);
    expect(unassigned.map((b) => b.id)).toEqual([]);
  });

  it('picks the root with the most matching leaves', () => {
    // neuromancer: cyberpunk + noir -> spec twice-ish vs computing once.
    const root = primaryRootForBook(sample!, tagMap, index);
    expect(index.rootIds).toContain(root);
  });

  it('breaks ties on authored root order, not tag order', () => {
    const a = { ...sample!, subjects: ['cyberpunk', 'artificial-intelligence'] };
    const b = { ...sample!, subjects: ['artificial-intelligence', 'cyberpunk'] };
    expect(primaryRootForBook(a, tagMap, index)).toBe(primaryRootForBook(b, tagMap, index));
  });
});

describe('leaf helpers', () => {
  it('identifies leaves as nodes without children', () => {
    for (const node of index.byId.values()) {
      expect(isLeaf(node)).toBe(node.childIds.length === 0);
    }
  });

  it('reports every book as a member of its ancestors too', () => {
    const spec = index.membersOf.get('spec');
    const cyber = index.membersOf.get('spec-sf-cyberpunk');
    expect(cyber?.size).toBeGreaterThan(0);
    for (const id of cyber ?? []) expect(spec?.has(id)).toBe(true);
  });
});
