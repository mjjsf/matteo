import type { Book, TagMap, TaxonomyIndex } from './types';
import { nodesForBook } from './taxonomy';
import { authorSlug } from './nodeRef';
import type { FeatureMatrix } from './features';

/** Everything the map needs to grow along a subject or an author.
 *
 *  Baked rather than derived in the browser for the same reason `neighbors.json`
 *  is: it is a pure function of the corpus, it costs a full pass over every book
 *  to build, and the browser would redo that work on every load to get an answer
 *  that cannot change between deploys.
 *
 *  **The hierarchy here comes from the authored taxonomy, never from
 *  statistics.** That is not a style preference — it is a measured result. I
 *  tried deriving containment from co-occurrence (B is narrower than A when most
 *  B-books are A-books but not the reverse) and over 205 tags it produced 42
 *  edges, a maximum chain depth of 2, and relations that frequently pointed the
 *  WRONG WAY: `epic-fantasy` came out as the parent of `fantasy` at 0.83, and
 *  `ethics` as the parent of `philosophy` at 0.56. Tag assignment is not
 *  hierarchical — a book tagged `epic-fantasy` is not reliably also tagged
 *  `fantasy` — so the conditional probabilities invert. Statistics recover
 *  correlation, not containment, and they are used below for exactly that:
 *  `relatedTags`, where correlation is the relation you actually want. */

export const GRAPH_INDEX_VERSION = 1;

/** How many books to keep per subject. Deep enough that expanding a subject
 *  several times keeps finding new titles, short enough that the artifact does
 *  not carry the whole corpus once per tag. */
export const BOOKS_PER_SUBJECT = 16;
/** How many related tags and authors to keep. */
export const RELATED_K = 12;

export interface TopicNode {
  label: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
}

export interface GraphIndexFile {
  version: number;
  inputHash: string;
  /** Taxonomy nodes, flattened. The hierarchy. */
  topics: Record<string, TopicNode>;
  rootTopics: string[];
  /** Raw tags mapped directly to a topic (not including its descendants'). */
  tagsForTopic: Record<string, string[]>;
  /** A tag can sit under more than one topic — 16 of 227 do — so this is a DAG,
   *  not a tree. Forcing a single parent would assert a containment the authored
   *  data deliberately does not make. */
  topicsForTag: Record<string, string[]>;
  /** Books under a topic including all its descendants, most characteristic first. */
  booksForTopic: Record<string, string[]>;
  booksForTag: Record<string, string[]>;
  /** TRUE totals, separate from the capped lists above.
   *
   *  `booksForTag` and `booksForTopic` stop at BOOKS_PER_SUBJECT so the artifact
   *  does not carry the corpus once per tag. Reporting their length as the count
   *  said "Arts & Culture — 16 books" for a topic holding 194, and showed three
   *  different subjects all claiming 16 in the branch menu. The list is what you
   *  will be shown; this is what is actually there, and they are not the same
   *  number. */
  countForTopic: Record<string, number>;
  countForTag: Record<string, number>;
  relatedTags: Record<string, string[]>;
  /** slug -> display name, so the UI never has to un-slug for display. */
  authorNames: Record<string, string>;
  booksForAuthor: Record<string, string[]>;
  relatedAuthors: Record<string, string[]>;
}

/** Cosine over two sets — used for "related", where correlation is the point. */
function cosine(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / Math.sqrt(a.size * b.size);
}

function topBy<T>(items: T[], score: (t: T) => number, k: number): T[] {
  return items
    .map((item) => ({ item, s: score(item) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.item);
}

export function buildGraphIndex(
  books: Book[],
  tagMap: TagMap,
  taxonomy: TaxonomyIndex,
  features: FeatureMatrix,
  /** Top-K similar books per corpus row — the same lists `neighbors.json`
   *  ships, reused so related authors rest on the tuned similarity model
   *  rather than a second, weaker one invented here. */
  neighborsOf: (bookIndex: number) => Array<{ index: number; score: number }>,
  inputHash: string,
): GraphIndexFile {

  // --- hierarchy, straight off the authored taxonomy ---
  const topics: Record<string, TopicNode> = {};
  for (const [id, node] of taxonomy.byId) {
    topics[id] = {
      label: node.label,
      parentId: node.parentId,
      childIds: node.childIds,
      depth: node.depth,
    };
  }

  const tagsForTopic: Record<string, string[]> = {};
  const topicsForTag: Record<string, string[]> = {};
  for (const [tag, nodeIds] of Object.entries(tagMap)) {
    const known = nodeIds.filter((n) => taxonomy.byId.has(n));
    if (known.length === 0) continue;
    topicsForTag[tag] = known;
    for (const n of known) (tagsForTopic[n] ??= []).push(tag);
  }
  for (const list of Object.values(tagsForTopic)) list.sort();

  // --- how characteristic a book is of a tag ---
  // Read straight out of the feature matrix rather than recomputed: a book's
  // weight on a tag is that tag's IDF divided by the L2 norm of the book's
  // subject block, which is exactly "how much of this book is this subject".
  // A broad tag on a book with many other subjects scores low; a defining one
  // on a focused book scores high. That is what stops `book-club`, on 157
  // books, returning arbitrary titles.
  const colOfTag = new Map<string, number>();
  features.vocab.forEach((meta, col) => {
    if (meta.block === 'subject') colOfTag.set(meta.key, col);
  });
  const weightOf = (bookIndex: number, tag: string): number => {
    const col = colOfTag.get(tag);
    if (col === undefined) return 0;
    return features.matrix[bookIndex]?.[col] ?? 0;
  };

  const booksByTag = new Map<string, number[]>();
  books.forEach((book, i) => {
    for (const tag of book.subjects) {
      const list = booksByTag.get(tag) ?? [];
      list.push(i);
      booksByTag.set(tag, list);
    }
  });

  const booksForTag: Record<string, string[]> = {};
  const countForTag: Record<string, number> = {};
  for (const [tag, indices] of booksByTag) {
    countForTag[tag] = indices.length;
    booksForTag[tag] = topBy(
      indices,
      // Falls back to a tiny constant so a tag pruned from the feature vocab
      // (df < 2) still lists its books rather than returning an empty branch.
      (i) => weightOf(i, tag) || 1e-6,
      BOOKS_PER_SUBJECT,
    ).map((i) => (books[i] as Book).id);
  }

  // --- related tags: correlation, which is what co-occurrence is good for ---
  const tagSets = new Map<string, Set<number>>();
  for (const [tag, indices] of booksByTag) tagSets.set(tag, new Set(indices));
  const allTags = [...tagSets.keys()];
  const relatedTags: Record<string, string[]> = {};
  for (const tag of allTags) {
    const mine = tagSets.get(tag) as Set<number>;
    relatedTags[tag] = topBy(
      allTags.filter((t) => t !== tag),
      (t) => cosine(mine, tagSets.get(t) as Set<number>),
      RELATED_K,
    );
  }

  // --- topics: books under a node INCLUDING descendants ---
  // `populateMembers` already computed exactly this set; all that is added here
  // is an order, using the same characteristic-ness measure over the topic's
  // own tags so the first books under "Existentialism" are the ones the label
  // actually describes.
  const booksForTopic: Record<string, string[]> = {};
  const countForTopic: Record<string, number> = {};
  const indexOfBook = new Map(books.map((b, i) => [b.id, i]));
  for (const [topicId, memberIds] of taxonomy.membersOf) {
    countForTopic[topicId] = memberIds.size;
    const own = new Set(tagsForTopic[topicId] ?? []);
    // Descendant tags count too, or a root with no directly-mapped tags of its
    // own would rank all its books at zero.
    const stack = [...(taxonomy.byId.get(topicId)?.childIds ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      for (const t of tagsForTopic[id] ?? []) own.add(t);
      stack.push(...(taxonomy.byId.get(id)?.childIds ?? []));
    }
    booksForTopic[topicId] = topBy(
      [...memberIds],
      (id) => {
        const i = indexOfBook.get(id);
        if (i === undefined) return 0;
        // SUM across the topic's tags, not max. Max ranked a book by its single
        // strongest tag, so one weak philosophy-ish tag on a YA fantasy scored
        // the same as a book that is entirely philosophy — which put Legendborn
        // sixth under "Philosophy & Religion". Summing asks how much of the book
        // falls inside this topic, which is the question.
        let total = 0;
        for (const t of own) total += weightOf(i, t);
        return total || 1e-6;
      },
      BOOKS_PER_SUBJECT,
    );
  }

  // --- authors ---
  const authorNames: Record<string, string> = {};
  const booksForAuthor: Record<string, string[]> = {};
  const authorOfBook = new Map<number, string[]>();

  books.forEach((book, i) => {
    const slugs: string[] = [];
    for (const name of book.authors) {
      const slug = authorSlug(name);
      if (!slug) continue;
      authorNames[slug] = name;
      (booksForAuthor[slug] ??= []).push(book.id);
      slugs.push(slug);
    }
    authorOfBook.set(i, slugs);
  });

  // Related authors, from the book neighbours already computed rather than from
  // cosine over each author's subject set. That cosine rewarded authors with
  // TINY sets — a one-book author sharing two tags outscored a real match — and
  // returned Daphne du Maurier and Mary Wollstonecraft as Le Guin's nearest.
  // Asking "whose books keep turning up next to yours" reuses the similarity
  // model that was already tuned and read for quality.
  const relatedAuthors: Record<string, string[]> = {};
  for (const [slug, bookIds] of Object.entries(booksForAuthor)) {
    // Only for authors with more than one book here — 178 of 762. For a
    // one-book author "related authors" is a restatement of that book's own
    // neighbours, so storing it cost 171 KB (38% of this artifact) to say
    // something the map could already say. The axis chooser hides an axis with
    // no entries, so those authors simply do not offer this branch, which is
    // the honest answer: there is no author-shaped relation to follow.
    if (bookIds.length < 2) continue;
    const score = new Map<string, number>();
    for (const id of bookIds) {
      const i = indexOfBook.get(id);
      if (i === undefined) continue;
      for (const n of neighborsOf(i)) {
        for (const other of authorOfBook.get(n.index) ?? []) {
          if (other === slug) continue;
          score.set(other, (score.get(other) ?? 0) + n.score);
        }
      }
    }
    relatedAuthors[slug] = topBy([...score.keys()], (s) => score.get(s) ?? 0, RELATED_K);
  }

  return {
    version: GRAPH_INDEX_VERSION,
    inputHash,
    topics,
    rootTopics: taxonomy.rootIds,
    tagsForTopic,
    topicsForTag,
    booksForTopic,
    booksForTag,
    countForTopic,
    countForTag,
    relatedTags,
    authorNames,
    booksForAuthor,
    relatedAuthors,
  };
}

/** Ancestors of a tag, nearest topic first — the walk up the hierarchy that
 *  makes "show me the tree above this" possible from any leaf. */
export function topicPathForTag(index: GraphIndexFile, tag: string): string[] {
  const start = index.topicsForTag[tag]?.[0];
  if (!start) return [];
  const path: string[] = [];
  let cursor: string | null = start;
  while (cursor) {
    path.push(cursor);
    cursor = index.topics[cursor]?.parentId ?? null;
  }
  return path;
}

/** True when `ancestor` is at or above `topic`. Used by the guard test that
 *  keeps hierarchy coming from the taxonomy rather than from co-occurrence. */
export function isAncestorTopic(
  index: GraphIndexFile,
  ancestor: string,
  topic: string,
): boolean {
  let cursor: string | null = index.topics[topic]?.parentId ?? null;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = index.topics[cursor]?.parentId ?? null;
  }
  return false;
}

export function nodesForBookIn(book: Book, tagMap: TagMap): string[] {
  return nodesForBook(book, tagMap);
}
