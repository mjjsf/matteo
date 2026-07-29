import Fuse from 'fuse.js';
import type { Book, SearchHit } from './types';

/** Fuzzy search over the corpus.
 *
 *  `description` is deliberately EXCLUDED from the index. At a few thousand
 *  books, indexing descriptions costs hundreds of milliseconds of bitap build
 *  on startup, and it makes matching noticeably worse: a description that
 *  happens to mention "space" would rank alongside a book actually titled
 *  *Space*. Title, authors, and subjects are what people search by. */
/** The books plus the fuzzy index over them.
 *
 *  One object because the prefix ranking below needs the collection and the
 *  fuzzy tier needs the index, and the two must describe the same books. Fuse
 *  keeps the collection internally but exposes it only on a private field, so
 *  the alternative was either a cast into Fuse's internals or passing two
 *  arguments everywhere and trusting they never drift apart. */
export interface SearchIndex {
  fuse: Fuse<Book>;
  books: Book[];
}

export function createSearchIndex(books: Book[]): SearchIndex {
  const fuse = new Fuse(books, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'authors', weight: 0.3 },
      { name: 'subjects', weight: 0.2 },
    ],
    // Tightened from 0.35. Fuse is now the LAST resort rather than the whole
    // ranking, so it only has to catch typos — it no longer needs to be loose
    // enough to find something for every query on its own.
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
  return { fuse, books };
}

/** One character is enough to search.
 *
 *  It used to be 2, on the theory that a single letter "matches almost
 *  everything". That was true of pure fuzzy matching, where one character
 *  scores against every title in the corpus — but with prefix ranking below,
 *  "d" has an obvious and useful answer: the books whose titles start with D. */
export const MIN_QUERY_LENGTH = 1;

/** Case- and diacritic-insensitive comparison key.
 *
 *  Without the NFD strip, searching "eleanor" misses *Éléanor* and searching
 *  "e" sorts accented titles into a separate clump after Z. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Leading articles are dropped for prefix purposes, so typing "g" finds
 *  *The Goldfinch* and not only titles that literally begin with G. English
 *  titles put a third of their number behind "The". */
function withoutArticle(folded: string): string {
  return folded.replace(/^(?:the|a|an)\s+/, '');
}

/** Ranking tier, lowest first. Below the fuzzy tier there is nothing. */
const TIER_TITLE_PREFIX = 0;
const TIER_TITLE_WORD_PREFIX = 1;
const TIER_AUTHOR_PREFIX = 2;
const TIER_TITLE_CONTAINS = 3;
const TIER_FUZZY = 4;

/** Fuse score above which a fuzzy match is discarded rather than shown.
 *
 *  Reordering the tiers alone did not fix the reported symptom: only one book
 *  matches "neuromancer" by prefix, so the fuzzy tier still padded the five
 *  remaining slots with Outlander, The Hating Game and Book Lovers. Fuse's own
 *  `threshold` does not prevent that — it gates per-key matching, while the
 *  composite weighted score it reports can be far higher.
 *
 *  Measured over the real 1016-book corpus:
 *    Neuromancer / "neuromancer"     0.000
 *    The Great Gatsby / "gatsby"     0.136
 *    Neuromancer / "neuromancr"      0.316   ← worst match worth keeping
 *    Le Guin's novels / "le guin"    0.355
 *    ────────────────────────────── gap ──
 *    Ariadne / "dune"                0.500
 *    The Duke and I / "dune"         0.707
 *    Outlander / "neuromancer"       0.771   ← the reported noise
 *
 *  0.45 sits in that gap with room on both sides. Showing nothing is better than
 *  padding: six slots of noise read as "these are related", which is a claim. */
const FUZZY_SCORE_CUTOFF = 0.45;

/** Which tier a book earns for `q`, or null if it does not match at all.
 *
 *  Exported for tests: the tier is the whole behaviour, and asserting on it
 *  directly is far more legible than inferring it from result order. */
export function matchTier(book: Book, q: string): number | null {
  const title = fold(book.title);
  if (title.startsWith(q) || withoutArticle(title).startsWith(q)) return TIER_TITLE_PREFIX;

  // Any word, so "hyperion" finds *The Fall of Hyperion*.
  if (title.split(/[\s:,.–—-]+/).some((w) => w.startsWith(q))) {
    return TIER_TITLE_WORD_PREFIX;
  }

  // Surnames as well as forenames — people search "le guin" as readily as
  // "ursula". The `includes` arm is what catches a multi-word surname: no single
  // word of "Ursula K. Le Guin" starts with "le guin".
  for (const author of book.authors) {
    const a = fold(author);
    if (a.startsWith(q) || a.includes(q) || a.split(/\s+/).some((w) => w.startsWith(q))) {
      return TIER_AUTHOR_PREFIX;
    }
  }

  if (title.includes(q)) return TIER_TITLE_CONTAINS;
  return null;
}

/** Search results, best first.
 *
 *  Explicitly tiered rather than left to Fuse. Fuse alone scored purely on
 *  fuzzy distance with `ignoreLocation`, which has no notion of "starts with" at
 *  all: typing a full title returned that title followed by five books sharing
 *  almost nothing with it, and typing one letter returned nothing whatsoever.
 *  Prefix matches are what people mean by search here, so they rank first and
 *  alphabetically — a list of D titles reads as a list — and Fuse fills whatever
 *  is left, which is the case it is actually good at: typos. */
export function runSearch(index: SearchIndex, query: string): SearchHit[] {
  const raw = query.trim();
  if (raw.length < MIN_QUERY_LENGTH) return [];
  const q = fold(raw);

  const tiered: Array<{ book: Book; tier: number; sortKey: string }> = [];
  for (const book of index.books) {
    const tier = matchTier(book, q);
    if (tier !== null) tiered.push({ book, tier, sortKey: withoutArticle(fold(book.title)) });
  }

  tiered.sort((a, b) => a.tier - b.tier || a.sortKey.localeCompare(b.sortKey));

  const hits: SearchHit[] = tiered.map(({ book, tier }) => ({
    book,
    // Kept on the same 0..1 "lower is better" scale Fuse uses, so `SearchHit`
    // means one thing regardless of which tier produced it.
    score: tier / (TIER_FUZZY + 1),
  }));

  const seen = new Set(hits.map((h) => h.book.id));
  for (const r of index.fuse.search(raw)) {
    const score = r.score ?? 1;
    // Sorted best-first by Fuse, so the first one over the line ends the tier.
    if (score > FUZZY_SCORE_CUTOFF) break;
    if (seen.has(r.item.id)) continue;
    seen.add(r.item.id);
    hits.push({ book: r.item, score });
  }

  return hits;
}
