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
 *  option that is absent: it reads as a promise. */

export interface BranchAxis {
  /** Stable id, carried in the shared URL. Either a bare word or a node ref. */
  id: string;
  label: string;
  count: number;
}

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
    const n = similar(ref).length;
    if (n > 0) out.push({ id: DEFAULT_AXIS, label: 'Related titles', count: n });
    for (const name of book?.authors ?? []) {
      const slug = authorSlug(name);
      // Only worth offering when the author has other work here — otherwise the
      // branch is one node that leads straight back to this book.
      const works = index.booksForAuthor[slug]?.length ?? 0;
      if (works > 1) out.push({ id: authorRef(slug), label: `By ${name}`, count: works });
    }
    for (const tag of book?.subjects ?? []) {
      const count = index.countForTag[tag] ?? index.booksForTag[tag]?.length ?? 0;
      if (count > 0) {
        out.push({ id: tagRef(tag), label: `In ${tag.replace(/-/g, ' ')}`, count });
      }
    }
    return out;
  }

  if (kind === 'topic') {
    // Books lead. Seeding a subject and getting a list of narrower subjects is
    // a table of contents when what was asked for was the shelf; the hierarchy
    // is still one click away, and the seed's first expansion takes this.
    const books = index.booksForTopic[id] ?? [];
    if (books.length > 0) {
      out.push({ id: 'books', label: 'Books in it', count: index.countForTopic[id] ?? books.length });
    }
    const children = index.topics[id]?.childIds ?? [];
    if (children.length > 0) {
      out.push({ id: 'narrower', label: 'Narrower subjects', count: children.length });
    }
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
): Candidate[] {
  const kind = kindOf(ref);
  const id = idOf(ref);

  if (axis === DEFAULT_AXIS) return similar(ref);

  if (axis.startsWith('author:') || axis.startsWith('tag:') || axis.startsWith('topic:')) {
    return [{ nodeRef: axis as NodeRef, weight: 1 }];
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
  if (axis.startsWith('tag:') || axis.startsWith('topic:')) return 'by subject';
  if (axis === 'books') return kindOf(ref) === 'author' ? 'by author' : 'by subject';
  return 'by subject';
}
