import type { GraphIndexFile } from './graphIndex';
import type { Book } from './types';
import {
  authorRef,
  authorSlug,
  bookRef,
  idOf,
  kindOf,
  tagRef,
  topicRef,
  type NodeRef,
} from './nodeRef';

/** The ways a node can be branched, and what each one grows.
 *
 *  Clicking used to grow one fixed thing, because a node could only be a book
 *  and a book had only one relation worth following. With four grains there are
 *  several honest answers to "what is next to this", and picking for the reader
 *  would be picking wrong most of the time — so the node offers its axes and the
 *  reader chooses.
 *
 *  Every axis carries a COUNT, and an axis with nothing behind it is not
 *  offered at all. An option that resolves to an empty branch is worse than an
 *  option that is absent: it reads as a promise.
 *
 *  NO NODE OFFERS MORE THAN `MAX_AXES`. That is a real invariant with a test on
 *  it, not an observation: a menu that silently truncated an option would be
 *  hiding a branch rather than declining to offer one. It is also why a book's
 *  authors and subjects are grouped into one axis each rather than one apiece —
 *  ungrouped, a book measured a median of five options and a maximum of nine. */

export interface BranchAxis {
  /** Stable id, carried in the shared URL. Either a bare word or a node ref. */
  id: string;
  label: string;
  /** How many nodes pressing this attaches.
   *
   *  For the grouped book axes that is the only number available — there is no
   *  single "how big is what is behind this" for a fan of four subjects — so it
   *  is the meaning everywhere, and the outline's numbers for book rows moved to
   *  match. It is also the more useful one for a control that grows things. */
  count: number;
}

/** The most axes any node can offer.
 *
 *  Was three, because the chooser was an ARC: segments spaced around a circle,
 *  where a fourth had to be crowded or truncated. The arc is gone — the chooser
 *  is a rectangular list — so the number now describes the vocabulary rather than
 *  the geometry, and it is four because a book has four honest relations. Still a
 *  real cap with a corpus-wide test behind it: a menu that silently dropped a
 *  fifth would be hiding a branch rather than declining to offer one. */
export const MAX_AXES = 4;

/** Growing along an axis attaches these, best first. */
export interface Candidate {
  nodeRef: NodeRef;
  weight: number;
}

export const DEFAULT_AXIS = 'titles';

/** Similar books, supplied by the store because they live in `neighbors.json`
 *  rather than in the graph index. */
export type SimilarBooks = (ref: NodeRef) => Candidate[];

/** A topic's own tags, minus any that is simply the topic under another name.
 *
 *  The topic `Existentialism` and the tag `existentialism` are the same thing;
 *  offering the tag as a child of the topic put two identically-labelled nodes
 *  side by side on the canvas, which reads as a bug rather than as a hierarchy.
 *  Search de-duplicates the same pair for the same reason. */
function ownTags(index: GraphIndexFile, topicId: string): string[] {
  const label = index.topics[topicId]?.label.toLowerCase();
  return (index.tagsForTopic[topicId] ?? []).filter(
    (t) => t.replace(/-/g, ' ').toLowerCase() !== label,
  );
}

function bookCandidates(ids: string[]): Candidate[] {
  // Weight falls with rank so the fan still encodes ordering in its geometry,
  // exactly as similarity weights do for a book branch.
  return ids.map((id, i) => ({ nodeRef: bookRef(id), weight: 1 - i * 0.05 }));
}

function ranked(refs: NodeRef[]): Candidate[] {
  return refs.map((nodeRef, i) => ({ nodeRef, weight: 1 - i * 0.05 }));
}

/** The authors of `book` who have other work in this corpus.
 *
 *  A one-book author is dropped: that branch would be a single node whose only
 *  child is the book you arrived from. 572 of the 1038 books are in that
 *  position, so this is the common case, not an edge case.
 *
 *  Shared by `axesFor` and `candidatesFor` on purpose. The number on the button
 *  and the fan the button grows are then the same list read twice, and cannot
 *  drift apart as the corpus changes. */
function branchableAuthors(
  index: GraphIndexFile,
  book: Book | undefined,
): Array<{ name: string; ref: NodeRef }> {
  const out: Array<{ name: string; ref: NodeRef }> = [];
  for (const name of book?.authors ?? []) {
    const slug = authorSlug(name);
    if ((index.booksForAuthor[slug]?.length ?? 0) > 1) out.push({ name, ref: authorRef(slug) });
  }
  return out;
}

/** Authors near this book's authors, minus the book's own.
 *
 *  Its own authors are what `More by Author` grows, and offering them from two
 *  different buttons would let the reader open the same node twice over and
 *  wonder why the second press did nothing. De-duplicated across authors too, so
 *  a co-written book does not list a shared neighbour once per collaborator. */
function relatedAuthorsFor(index: GraphIndexFile, book: Book | undefined): NodeRef[] {
  const own = new Set((book?.authors ?? []).map(authorSlug));
  const seen = new Set<string>();
  const out: NodeRef[] = [];
  for (const slug of own) {
    for (const near of index.relatedAuthors[slug] ?? []) {
      if (own.has(near) || seen.has(near)) continue;
      seen.add(near);
      out.push(authorRef(near));
    }
  }
  return out;
}

/** The subjects of `book` that name a shelf with something on it. */
function branchableSubjects(index: GraphIndexFile, book: Book | undefined): NodeRef[] {
  return (book?.subjects ?? [])
    .filter((tag) => (index.countForTag[tag] ?? index.booksForTag[tag]?.length ?? 0) > 0)
    .map((tag) => tagRef(tag));
}

export function axesFor(
  ref: NodeRef,
  index: GraphIndexFile,
  book: Book | undefined,
  similar: SimilarBooks,
): BranchAxis[] {
  const kind = kindOf(ref);
  const id = idOf(ref);
  const out: BranchAxis[] = [];

  if (kind === 'book') {
    // `titles` stays first: a seeded book expands along `axesFor(...)[0]` before
    // anyone has clicked anything, and similarity is the right thing to open with.
    const n = similar(ref).length;
    if (n > 0) out.push({ id: DEFAULT_AXIS, label: 'Related Titles', count: n });

    // One axis per author and one per subject is what this used to be, and it
    // measured at a median of 5 options and a maximum of 9 — a list, not a
    // choice. Grouped, a book offers at most four.
    const subjects = branchableSubjects(index, book);
    if (subjects.length > 0) {
      out.push({ id: 'subjects', label: 'Related Subjects', count: subjects.length });
    }

    const near = relatedAuthorsFor(index, book);
    if (near.length > 0) {
      out.push({ id: 'related-authors', label: 'Related Authors', count: near.length });
    }

    const authors = branchableAuthors(index, book);
    if (authors.length > 0) {
      out.push({ id: 'authors', label: 'More by Author', count: authors.length });
    }
    return out;
  }

  if (kind === 'topic') {
    const books = index.booksForTopic[id] ?? [];
    const children = index.topics[id]?.childIds ?? [];
    const bookAxis = {
      id: 'books',
      label: 'Books in it',
      count: index.countForTopic[id] ?? books.length,
    };
    const narrowerAxis = {
      id: 'narrower',
      label: 'Narrower subjects',
      count: children.length,
    };
    // A node can only be expanded ONCE, along one axis, so whichever axis comes
    // first is the one a seed takes and the only one that node will ever use.
    // That makes the order load-bearing rather than cosmetic:
    //
    //  - a topic WITH children leads with them, or seeding "Continental
    //    Philosophy" grows eight books and permanently locks out the six
    //    schools underneath it — the tree the hierarchy exists to show;
    //  - a LEAF topic leads with books, or seeding "Existentialism" offers a
    //    table of contents when what was asked for was the shelf.
    if (children.length > 0) out.push(narrowerAxis);
    if (books.length > 0) out.push(bookAxis);
    const tags = ownTags(index, id);
    if (tags.length > 0) out.push({ id: 'tags', label: 'Subjects within', count: tags.length });
    return out;
  }

  if (kind === 'tag') {
    const books = index.booksForTag[id] ?? [];
    if (books.length > 0) {
      out.push({ id: 'books', label: 'Books in it', count: index.countForTag[id] ?? books.length });
    }
    const related = index.relatedTags[id] ?? [];
    if (related.length > 0) {
      out.push({ id: 'related', label: 'Related subjects', count: related.length });
    }
    const broader = index.topicsForTag[id] ?? [];
    if (broader.length > 0) {
      out.push({ id: 'broader', label: 'Broader subject', count: broader.length });
    }
    return out;
  }

  // author
  const works = index.booksForAuthor[id] ?? [];
  if (works.length > 0) out.push({ id: 'books', label: 'Their books', count: works.length });
  const near = index.relatedAuthors[id] ?? [];
  if (near.length > 0) out.push({ id: 'authors', label: 'Related authors', count: near.length });
  return out;
}

/** What growing `ref` along `axis` attaches.
 *
 *  An axis naming a single ref — `author:le-guin`, `tag:existentialism` —
 *  attaches THAT node, not the things behind it. That is what makes a branch run
 *  through kinds: opening a book by its author gives you the author, and opening
 *  the author gives you their work. Flattening straight to the books would lose
 *  the hop that carries the meaning. */
export function candidatesFor(
  ref: NodeRef,
  axis: string,
  index: GraphIndexFile,
  similar: SimilarBooks,
  book?: Book,
): Candidate[] {
  const kind = kindOf(ref);
  const id = idOf(ref);

  if (axis === DEFAULT_AXIS) return similar(ref);

  // A bare `author:`/`tag:`/`topic:` id was its own axis before the book axes
  // were grouped, and those ids travel in the `path` of every shared URL. Kept
  // so links already in the wild keep replaying to the same map — nothing
  // produces them any more, and nothing needs to.
  if (axis.startsWith('author:') || axis.startsWith('tag:') || axis.startsWith('topic:')) {
    return [{ nodeRef: axis as NodeRef, weight: 1 }];
  }

  if (kind === 'book') {
    // Grouped: one press attaches every author, or every subject, rather than
    // making the reader pick one of seven tags off a list.
    if (axis === 'authors') return ranked(branchableAuthors(index, book).map((a) => a.ref));
    if (axis === 'subjects') return ranked(branchableSubjects(index, book));
    if (axis === 'related-authors') return ranked(relatedAuthorsFor(index, book));
  }

  if (kind === 'topic') {
    if (axis === 'narrower') {
      return (index.topics[id]?.childIds ?? []).map((c, i) => ({
        nodeRef: topicRef(c),
        weight: 1 - i * 0.05,
      }));
    }
    if (axis === 'tags') {
      return ownTags(index, id).map((t, i) => ({
        nodeRef: tagRef(t),
        weight: 1 - i * 0.05,
      }));
    }
    if (axis === 'books') return bookCandidates(index.booksForTopic[id] ?? []);
  }

  if (kind === 'tag') {
    if (axis === 'books') return bookCandidates(index.booksForTag[id] ?? []);
    if (axis === 'related') {
      return (index.relatedTags[id] ?? []).map((t, i) => ({
        nodeRef: tagRef(t),
        weight: 1 - i * 0.05,
      }));
    }
    if (axis === 'broader') {
      return (index.topicsForTag[id] ?? []).map((t, i) => ({
        nodeRef: topicRef(t),
        weight: 1 - i * 0.05,
      }));
    }
  }

  if (kind === 'author') {
    if (axis === 'books') return bookCandidates(index.booksForAuthor[id] ?? []);
    if (axis === 'authors') {
      return (index.relatedAuthors[id] ?? []).map((s, i) => ({
        nodeRef: authorRef(s),
        weight: 1 - i * 0.05,
      }));
    }
  }

  return [];
}

/** Short label for an edge, so the outline can say why two things are adjacent.
 *
 *  Takes the SOURCE as well as the axis: `books` means "their books" from an
 *  author and "books in it" from a subject, and reporting both as the same
 *  relation would mislabel half the map. */
export function axisNote(ref: NodeRef, axis: string): string {
  if (axis === DEFAULT_AXIS) return 'similar';
  if (axis.startsWith('author:') || axis === 'authors') return 'by author';
  if (axis === 'related-authors') return 'by author';
  if (axis.startsWith('tag:') || axis.startsWith('topic:') || axis === 'subjects') {
    return 'by subject';
  }
  if (axis === 'books') return kindOf(ref) === 'author' ? 'by author' : 'by subject';
  return 'by subject';
}
