import { create } from 'zustand';
import Fuse from 'fuse.js';
import type {
  Book,
  LayoutFile,
  SearchHit,
  SearchTreeNode,
  TagMap,
  TaxonomyIndex,
} from '@/domain/types';
import { buildTaxonomyIndex, populateMembers } from '@/domain/taxonomy';
import { buildSearchTree } from '@/domain/searchTree';
import { createSearchIndex, matchedIdsFor, runSearch } from '@/domain/search';
import corpusJson from '@/generated/corpus.json';
import layoutJson from '@/generated/layout.json';
import taxonomyJson from '../../data/taxonomy.json';
import tagMapJson from '../../data/tagMap.json';

const books = corpusJson as unknown as Book[];
const layout = layoutJson as unknown as LayoutFile;
const tagMap = tagMapJson as unknown as TagMap;

const taxonomy: TaxonomyIndex = populateMembers(
  buildTaxonomyIndex(taxonomyJson),
  books,
  tagMap,
);

/** Positions land straight into a Float32Array — no per-point object
 *  allocation, which is why the artifact stores a flat array. */
const positions = new Float32Array(layout.positions);
const byId = new Map<string, number>(books.map((b, i) => [b.id, i]));
const fuse: Fuse<Book> = createSearchIndex(books);

/** Cap on how many results are rendered as DOM rows. The 3D highlighting still
 *  reflects every match. */
export const MAX_LISTED_RESULTS = 60;

export interface FlyTarget {
  position: [number, number, number];
  distance: number;
  /** Bumped on every request so re-selecting the same book re-triggers the
   *  animation; an object-identity check on equal coordinates would not. */
  nonce: number;
}

export interface AppState {
  books: Book[];
  byId: Map<string, number>;
  positions: Float32Array;
  taxonomy: TaxonomyIndex;
  tagMap: TagMap;
  radius: number;

  hoveredId: string | null;
  selectedId: string | null;
  activeBranchId: string | null;
  query: string;
  results: SearchHit[];
  /** null = no active search (show everything). An empty Set = searched and
   *  found nothing (dim everything). These must stay distinct. */
  matchedIds: Set<string> | null;
  searchTree: SearchTreeNode[];
  focusedResultIndex: number;
  flyTarget: FlyTarget | null;

  setHovered: (id: string | null) => void;
  select: (id: string | null, opts?: { fly?: boolean }) => void;
  setActiveBranch: (id: string | null, opts?: { fly?: boolean }) => void;
  setQuery: (q: string) => void;
  setFocusedResultIndex: (i: number) => void;
  /** The nonce is assigned internally, so callers pass only where to go. */
  requestFly: (target: Omit<FlyTarget, 'nonce'> | null) => void;
  /** Unwinds one level per call: selection, then branch, then query.
   *  Returns true if anything changed. */
  escape: () => boolean;
}

export function positionOf(state: Pick<AppState, 'byId' | 'positions'>, id: string):
  | [number, number, number]
  | null {
  const idx = state.byId.get(id);
  if (idx === undefined) return null;
  return [
    state.positions[idx * 3] ?? 0,
    state.positions[idx * 3 + 1] ?? 0,
    state.positions[idx * 3 + 2] ?? 0,
  ];
}

/** Centroid and bounding radius of a set of books, for framing the camera. */
export function centroidOf(
  state: Pick<AppState, 'byId' | 'positions'>,
  ids: Iterable<string>,
): { center: [number, number, number]; radius: number } | null {
  let n = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const points: Array<[number, number, number]> = [];
  for (const id of ids) {
    const p = positionOf(state, id);
    if (!p) continue;
    points.push(p);
    cx += p[0];
    cy += p[1];
    cz += p[2];
    n++;
  }
  if (n === 0) return null;
  cx /= n;
  cy /= n;
  cz /= n;
  let radius = 0;
  for (const p of points) {
    radius = Math.max(radius, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  }
  return { center: [cx, cy, cz], radius };
}

let flyNonce = 0;

export const useStore = create<AppState>((set, get) => ({
  books,
  byId,
  positions,
  taxonomy,
  tagMap,
  radius: layout.bounds.radius,

  hoveredId: null,
  selectedId: null,
  activeBranchId: null,
  query: '',
  results: [],
  matchedIds: null,
  searchTree: [],
  focusedResultIndex: -1,
  flyTarget: null,

  setHovered: (id) => {
    if (get().hoveredId === id) return;
    set({ hoveredId: id });
  },

  select: (id, opts) => {
    set({ selectedId: id });
    if (id && opts?.fly) {
      const state = get();
      const p = positionOf(state, id);
      if (p) get().requestFly({ position: p, distance: state.radius * 0.28 });
    }
  },

  setActiveBranch: (id, opts) => {
    set({ activeBranchId: id });
    if (id && opts?.fly) {
      const state = get();
      const members = state.taxonomy.membersOf.get(id);
      if (members) {
        const frame = centroidOf(state, members);
        if (frame) {
          get().requestFly({
            position: frame.center,
            distance: Math.max(frame.radius * 1.9, state.radius * 0.2),
          });
        }
      }
    }
  },

  setQuery: (q) => {
    const state = get();
    const results = runSearch(fuse, q);
    const matchedIds = matchedIdsFor(results, q);
    const matchedBooks = matchedIds
      ? results.map((r) => r.book)
      : [];
    set({
      query: q,
      results,
      matchedIds,
      focusedResultIndex: -1,
      searchTree: matchedIds
        ? buildSearchTree(matchedBooks, state.tagMap, state.taxonomy)
        : [],
      // A branch filter scoped to the previous query is meaningless once the
      // query changes.
      activeBranchId: null,
    });
  },

  setFocusedResultIndex: (i) => set({ focusedResultIndex: i }),

  requestFly: (target) => {
    if (!target) {
      set({ flyTarget: null });
      return;
    }
    flyNonce += 1;
    set({ flyTarget: { ...target, nonce: flyNonce } });
  },

  escape: () => {
    const state = get();
    if (state.selectedId !== null) {
      set({ selectedId: null });
      return true;
    }
    if (state.activeBranchId !== null) {
      set({ activeBranchId: null });
      return true;
    }
    if (state.query !== '') {
      get().setQuery('');
      return true;
    }
    return false;
  },
}));
