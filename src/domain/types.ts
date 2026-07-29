/** Core data shapes. Authored data in `data/` conforms to these; the app reads
 *  the merged/generated forms from `src/generated/`. */

export interface Book {
  /** Stable slug, unique across the corpus. Used in URLs, so never renumber. */
  id: string;
  title: string;
  authors: string[];
  /** First publication year. */
  year: number;
  /** Raw subject tags. Every tag must resolve through `data/tagMap.json`. */
  subjects: string[];
  description: string;
  /** Optional; only present when the real ISBN is known. Never fabricated —
   *  a checksum-valid but wrong ISBN would deep-link to the wrong product. */
  isbn13?: string;
  isbn10?: string;
}

/** Authored taxonomy is a nested tree — far easier to hand-edit than a flat
 *  list with parent pointers. Flattened into a `TaxonomyIndex` at load. */
export interface TaxonomyNodeSpec {
  id: string;
  label: string;
  children?: TaxonomyNodeSpec[];
}

export interface TaxonomyFile {
  version: number;
  roots: TaxonomyNodeSpec[];
}

export interface TaxonomyNode {
  id: string;
  label: string;
  parentId: string | null;
  childIds: string[];
  /** 0 for roots. */
  depth: number;
  /** The depth-0 ancestor (itself, if it is a root). */
  rootId: string;
}

export interface TaxonomyIndex {
  byId: Map<string, TaxonomyNode>;
  rootIds: string[];
  maxDepth: number;
  /** Books mapped to this node **or any descendant**. Precomputed once. */
  membersOf: Map<string, Set<string>>;
  /** Every ancestor id of a node, nearest first, excluding the node itself. */
  ancestorsOf: Map<string, string[]>;
}

/** raw subject tag -> taxonomy node ids it classifies into. */
export type TagMap = Record<string, string[]>;

export interface SearchHit {
  book: Book;
  score: number;
}
