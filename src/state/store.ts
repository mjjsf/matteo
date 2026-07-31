import { create } from 'zustand';
import type { Book, SearchHit } from '@/domain/types';
import type { NeighborsFile } from '@/domain/similarity';
import { createSearchIndex, runSearch, type SearchIndex } from '@/domain/search';
import { bookRef, idOf, isBook, type NodeRef } from '@/domain/nodeRef';
import {
  MAX_NODES,
  SOFT_CAP,
  asSlot,
  childrenAtDepth,
  collapseNode,
  emptyGraph,
  expandNode,
  graphBounds,
  seedGraph,
  type Graph,
  type Slot,
} from '@/domain/graph';
/** The loaded corpus, or null before `hydrate` runs.
 *
 *  Module-level rather than in the store because these are derived indexes, not
 *  state: nothing re-renders when they change, because they change exactly once.
 *  Keeping them out of the store also keeps `bookById` and `neighborsOf` cheap
 *  enough to call from a frame loop.
 *
 *  The taxonomy used to be built here too — `populateMembers` over every book —
 *  and was then read by nothing at all. It cost 30KB of bundle and 14ms of
 *  startup, both growing with the corpus. It is a build-time concern only: the
 *  bake needs it, the browser does not. */
interface Loaded {
  books: Book[];
  neighborsFile: NeighborsFile;
  /** Corpus row index. Distinct from a graph `Slot` — see the comment on `Slot`. */
  corpusIndexOf: Map<string, number>;
  searchIndex: SearchIndex;
}

let loaded: Loaded | null = null;

/** How many suggestions the landing input offers. */
export const MAX_SUGGESTIONS = 6;

export interface FlyTarget {
  position: [number, number, number];
  distance: number;
  /** Bumped every request so re-flying to identical coordinates still animates. */
  nonce: number;
}

export type Phase = 'empty' | 'active';

export type Status = 'loading' | 'ready' | 'error';

export interface AppState {
  status: Status;
  /** Set only when `status` is 'error'. */
  loadError: string | null;
  books: Book[];
  corpusIndexOf: Map<string, number>;

  phase: Phase;
  query: string;
  suggestions: SearchHit[];
  /** Someone submitted the form before the corpus finished downloading.
   *
   *  The landing input is live from first paint, so a fast typist can name a
   *  book and press Enter while the search index is still being fetched. Without
   *  this the keypress lands on an empty suggestion list and does nothing, and
   *  they have to press it again once the list appears. `hydrate` consumes it. */
  seedWhenReady: boolean;

  graph: Graph;
  /** Bumped on any topology change so the scene can react imperatively without
   *  subscribing to the node array itself. */
  revision: number;
  /** Set when an expansion was refused, so the UI can say why instead of the
   *  click appearing to do nothing. */
  notice: string | null;
  /** Slots expanded since seeding, in order.
   *
   *  This is what makes a shared link restore an actual exploration rather than
   *  just a starting book. Placement is deterministic, so replaying the seed and
   *  then these slots in order reproduces the identical graph. */
  path: Slot[];

  hoveredRef: NodeRef | null;
  /** The pointer is inside the rollover card, so the hover must not be cleared.
   *
   *  The card sits offset from the cursor, so reaching the buy link inside it
   *  crosses empty canvas. Without this the card vanished in that gap and could
   *  never be clicked. */
  hoverLocked: boolean;
  selectedRef: NodeRef | null;
  flyTarget: FlyTarget | null;

  /** Install a corpus. Called by `loadCorpus` in the app and directly by tests,
   *  so both paths exercise the same wiring. */
  hydrate: (books: Book[], neighborsFile: NeighborsFile) => void;
  failToLoad: (message: string) => void;
  setQuery: (q: string) => void;
  seed: (ref: NodeRef) => void;
  /** Seed from the current query's best match. Returns false if nothing matched. */
  seedFromQuery: () => boolean;
  /** Replay a seed plus an expansion path, for restoring a shared link. */
  restore: (ref: NodeRef, path: number[]) => void;
  expand: (slot: Slot) => void;
  /** Remove everything grown from `slot`, leaving it re-growable.
   *
   *  The counterpart to `expand`, so a map can shrink as well as grow — until now
   *  it only ever got bigger until you started over. Surviving nodes keep their
   *  exact positions; see `collapseNode`. */
  collapse: (slot: Slot) => void;
  setHovered: (ref: NodeRef | null) => void;
  lockHover: (locked: boolean) => void;
  select: (ref: NodeRef | null, opts?: { fly?: boolean }) => void;
  requestFly: (target: Omit<FlyTarget, 'nonce'> | null) => void;
  /** Frame the whole graph. Expansion deliberately flies to the node you just
   *  opened, which is right in the moment and leaves you a long way from
   *  everything else after twenty of them. This is the way back. */
  fitAll: () => void;
  dismissNotice: () => void;
  /** Unwind one level. Returns whether anything changed, so the key handler only
   *  swallows Escape when it actually did something. */
  escape: () => boolean;
  reset: () => void;
  /** Start a fresh graph from a book already on screen — the escape hatch when
   *  the graph is full, and better than pruning branches someone chose to grow. */
  reseedFrom: (ref: NodeRef) => void;
}

export function bookById(id: string): Book | undefined {
  if (!loaded) return undefined;
  const i = loaded.corpusIndexOf.get(id);
  return i === undefined ? undefined : loaded.books[i];
}

/** The book a ref points at, or undefined for a ref of another grain. */
export function bookForRef(ref: NodeRef): Book | undefined {
  return isBook(ref) ? bookById(idOf(ref)) : undefined;
}

/** Neighbours of a book, best match first, already filtered by the similarity
 *  floor at bake time. */
export function similarBooks(ref: NodeRef): Array<{ nodeRef: NodeRef; weight: number }> {
  if (!loaded || !isBook(ref)) return [];
  const i = loaded.corpusIndexOf.get(idOf(ref));
  if (i === undefined) return [];
  const raw = loaded.neighborsFile.neighbors[i] ?? [];
  const best = raw[0]?.[1] ?? 1;
  return raw.flatMap(([j, score]) => {
    const other = loaded?.books[j];
    if (!other) return [];
    // Normalise against this book's own best match so the radius cue is
    // meaningful even for books whose absolute scores are all modest.
    return [{ nodeRef: bookRef(other.id), weight: best > 0 ? score / best : 0.5 }];
  });
}

let flyNonce = 0;

export const useStore = create<AppState>((set, get) => ({
  status: 'loading',
  loadError: null,
  books: [],
  corpusIndexOf: new Map(),

  phase: 'empty',
  query: '',
  suggestions: [],
  seedWhenReady: false,

  graph: emptyGraph(),
  revision: 0,
  notice: null,
  path: [],

  hoveredRef: null,
  hoverLocked: false,
  selectedRef: null,
  flyTarget: null,

  hydrate: (nextBooks, neighborsFile) => {
    loaded = {
      books: nextBooks,
      neighborsFile,
      corpusIndexOf: new Map(nextBooks.map((b, i) => [b.id, i])),
      searchIndex: createSearchIndex(nextBooks),
    };
    set({
      status: 'ready',
      loadError: null,
      books: nextBooks,
      corpusIndexOf: loaded.corpusIndexOf,
      // Run the search against whatever was typed while this was downloading.
      // Without it the list stays empty until the next keystroke, so someone who
      // typed a whole title during the fetch is left looking at nothing.
      suggestions: runSearch(loaded.searchIndex, get().query).slice(0, MAX_SUGGESTIONS),
    });
    if (get().seedWhenReady) {
      set({ seedWhenReady: false });
      get().seedFromQuery();
    }
  },

  failToLoad: (message) => set({ status: 'error', loadError: message }),

  setQuery: (q) => {
    // The query is recorded even before the index exists. It used to return
    // early, which discarded the keystroke entirely — and because the input is
    // controlled on `query`, that made the field look broken rather than slow:
    // characters typed during the corpus fetch never appeared at all.
    const index = loaded?.searchIndex;
    set({ query: q, suggestions: index ? runSearch(index, q).slice(0, MAX_SUGGESTIONS) : [] });
  },

  seed: (ref) => {
    if (!bookForRef(ref)) return;

    let graph = seedGraph(ref);
    // Expand immediately: a lone point is not a map. The first generation is
    // what makes the idea legible in the first second.
    const candidates = similarBooks(ref);
    const result = expandNode(graph, 0, candidates, childrenAtDepth(0), MAX_NODES);
    graph = result.graph;
    if (graph.nodes[0]) graph.nodes[0].expandable = candidates.length > 0;

    set({
      phase: 'active',
      graph,
      path: [],
      revision: get().revision + 1,
      selectedRef: ref,
      notice: null,
      suggestions: [],
    });
    // Framed on the centre of what was placed, not on the seed. Growth heads
    // outward along +Y from the origin, so targeting the seed would park the
    // whole first generation in the top half of the screen with dead space
    // below. Far enough back that it clears the side panels, which together take
    // roughly half the width on a laptop screen.
    get().requestFly({ position: graphBounds(graph).center, distance: 38 });
  },

  seedFromQuery: () => {
    if (!loaded) return false;
    const best = get().suggestions[0] ?? runSearch(loaded.searchIndex, get().query)[0];
    if (!best) return false;
    get().seed(bookRef(best.book.id));
    return true;
  },

  restore: (ref, path) => {
    if (!bookForRef(ref)) return;
    get().seed(ref);
    // Replayed through the same action a click uses, so a restored graph is
    // built by exactly the code that built the original — no second placement
    // path that could drift out of agreement with the first.
    for (const slot of path) get().expand(asSlot(slot));
    set({ selectedRef: ref });
  },

  expand: (slot) => {
    const state = get();
    const node = state.graph.nodes[slot];
    if (!node) return;

    if (state.graph.nodes.length >= SOFT_CAP) {
      set({
        notice: `This graph is full at ${SOFT_CAP} books. Open a book and start a new map from it.`,
      });
      return;
    }

    const candidates = similarBooks(node.nodeRef);
    const result = expandNode(
      state.graph,
      slot,
      candidates,
      childrenAtDepth(node.generation),
      SOFT_CAP,
    );

    if (result.added.length === 0) {
      const graph = result.graph;
      // Mark it a leaf so it stops inviting a click that cannot do anything.
      const target = graph.nodes[slot];
      if (target) target.expandable = false;
      set({
        graph: { ...graph },
        revision: state.revision + 1,
        notice:
          result.reason === 'at-capacity'
            ? `This graph is full at ${SOFT_CAP} books. Open a book and start a new map from it.`
            : result.reason === 'already-expanded'
              ? null
              : 'No further similar books — this is a leaf.',
      });
      return;
    }

    // A node whose neighbours are now all on screen becomes a leaf.
    const graph = result.graph;
    for (const index of result.added) {
      const child = graph.nodes[index];
      if (child) child.expandable = similarBooks(child.nodeRef).length > 0;
    }

    set({ graph, path: [...state.path, slot], revision: state.revision + 1, notice: null });
    // Framed on the node that was just expanded, not on the whole graph: the new
    // children are what the click asked for, and pulling back to fit everything
    // would shrink them away with each generation.
    get().requestFly({
      position: node.target,
      distance: Math.max(30, graphBounds(graph).radius * 0.8),
    });
  },

  collapse: (slot) => {
    const state = get();
    const node = state.graph.nodes[slot];
    if (!node || !node.expanded) return;

    const { graph, removed, oldToNew } = collapseNode(state.graph, slot);
    if (removed.length === 0) return;

    const gone = new Set(removed.map((i) => state.graph.nodes[i]?.nodeRef));
    // The path is a list of slots, and every slot after a removal shifts. Remap
    // rather than rebuild: a shared link has to keep replaying to this graph.
    // The collapsed node drops out too — it is no longer an expansion.
    const path = state.path
      .filter((s) => s !== slot && oldToNew.has(s))
      .map((s) => asSlot(oldToNew.get(s) as number));

    set({
      graph,
      path,
      revision: state.revision + 1,
      notice: null,
      // Both are book ids, so they only need clearing when the book itself left.
      selectedRef: state.selectedRef && gone.has(state.selectedRef) ? null : state.selectedRef,
      hoveredRef: state.hoveredRef && gone.has(state.hoveredRef) ? null : state.hoveredRef,
    });
  },

  setHovered: (ref) => {
    // A locked hover ignores only the CLEAR. Moving to a different node still
    // works, so the pointer never gets trapped on a stale card.
    if (ref === null && get().hoverLocked) return;
    if (get().hoveredRef === ref) return;
    set({ hoveredRef: ref });
  },

  lockHover: (locked) => {
    if (get().hoverLocked === locked) return;
    set({ hoverLocked: locked });
  },

  select: (ref, opts) => {
    set({ selectedRef: ref });
    if (!ref || !opts?.fly) return;
    const state = get();
    const slot = state.graph.indexOf.get(ref);
    if (slot === undefined) return;
    const node = state.graph.nodes[slot];
    if (node) get().requestFly({ position: node.target, distance: 22 });
  },

  requestFly: (target) => {
    if (!target) {
      set({ flyTarget: null });
      return;
    }
    flyNonce += 1;
    set({ flyTarget: { ...target, nonce: flyNonce } });
  },

  fitAll: () => {
    const { graph } = get();
    if (graph.nodes.length === 0) return;
    const bounds = graphBounds(graph);
    // 2.4x the radius clears the 45-degree field of view with margin for the
    // labels, which extend past the points they belong to.
    get().requestFly({ position: bounds.center, distance: Math.max(30, bounds.radius * 2.4) });
  },

  dismissNotice: () => set({ notice: null }),

  // One level per press — notice, then selection, then the whole map. Clearing
  // everything at once would throw away an exploration someone spent a dozen
  // clicks building, which is exactly the kind of thing that is infuriating
  // every single time it happens.
  escape: () => {
    const state = get();
    if (state.notice) {
      set({ notice: null });
      return true;
    }
    if (state.selectedRef) {
      set({ selectedRef: null });
      return true;
    }
    if (state.phase === 'active') {
      get().reset();
      return true;
    }
    return false;
  },

  reset: () =>
    set({
      phase: 'empty',
      graph: emptyGraph(),
      path: [],
      revision: get().revision + 1,
      query: '',
      suggestions: [],
      seedWhenReady: false,
      selectedRef: null,
      hoveredRef: null,
      hoverLocked: false,
      notice: null,
      flyTarget: null,
    }),

  reseedFrom: (ref) => {
    get().reset();
    get().seed(ref);
  },
}));

/** Slot of a book currently on screen, or null. */
export function slotOf(state: AppState, ref: NodeRef): Slot | null {
  const i = state.graph.indexOf.get(ref);
  return i === undefined ? null : asSlot(i);
}

/** Settled position of a book currently on screen. Returns null for books that
 *  are in the corpus but not in the graph — the old version returned a position
 *  for any book, which under a subgraph would draw rings at phantom locations. */
export function positionOf(state: AppState, ref: NodeRef): [number, number, number] | null {
  const slot = slotOf(state, ref);
  if (slot === null) return null;
  return state.graph.nodes[slot]?.target ?? null;
}
