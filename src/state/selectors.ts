import type { Book, TagMap } from '@/domain/types';
import { RELATION, type RelationKind } from '@/domain/palette';
import { nodesForBook } from '@/domain/taxonomy';

/** Point visibility states written into the `aState` buffer attribute. */
export const POINT_STATE = {
  dim: 0,
  normal: 1,
  emphasized: 2,
} as const;

export interface StateInputs {
  books: Book[];
  /** null = no active search. An empty Set = searched, found nothing. */
  matchedIds: Set<string> | null;
  /** null = no branch filter. */
  branchMembers: Set<string> | null;
}

/** Compute the per-point visibility buffer.
 *
 *  Visible = (matched ?? ALL) ∩ (branchMembers ?? ALL). Pure, and writes into a
 *  preallocated array so hovering and filtering never allocate. */
export function computeStateBuffer(inputs: StateInputs, out: Float32Array): void {
  const { books, matchedIds, branchMembers } = inputs;
  const filtering = matchedIds !== null || branchMembers !== null;

  for (let i = 0; i < books.length; i++) {
    const id = (books[i] as Book).id;
    const inSearch = matchedIds === null || matchedIds.has(id);
    const inBranch = branchMembers === null || branchMembers.has(id);
    const visible = inSearch && inBranch;

    out[i] = visible
      ? filtering
        ? POINT_STATE.emphasized
        : POINT_STATE.normal
      : POINT_STATE.dim;
  }
}

/** Relation of every book to the hovered one, written into `aRelation`.
 *
 *  This is the rollover colouring: at rest nothing is coloured, and on hover
 *  only the handful of related points take a hue. That is what keeps the palette
 *  within its measured limits — see `domain/palette.ts`. */
export function computeRelationBuffer(
  books: Book[],
  hoveredId: string | null,
  tagMap: TagMap,
  out: Float32Array,
): void {
  if (hoveredId === null) {
    out.fill(RELATION.none);
    return;
  }

  const hovered = books.find((b) => b.id === hoveredId);
  if (!hovered) {
    out.fill(RELATION.none);
    return;
  }

  const hoveredAuthors = new Set(hovered.authors);
  const hoveredTags = new Set(hovered.subjects);
  const hoveredLeaves = new Set(nodesForBook(hovered, tagMap));

  for (let i = 0; i < books.length; i++) {
    const book = books[i] as Book;
    if (book.id === hoveredId) {
      out[i] = RELATION.none;
      continue;
    }

    let kind: RelationKind = RELATION.none;

    // Author is the strongest signal and wins, then subject, then a bare shared
    // tag. Checked in that order so a book that is both shows the stronger one.
    if (book.authors.some((a) => hoveredAuthors.has(a))) {
      kind = RELATION.sameAuthor;
    } else if (nodesForBook(book, tagMap).some((n) => hoveredLeaves.has(n))) {
      kind = RELATION.sameSubject;
    } else if (book.subjects.some((t) => hoveredTags.has(t))) {
      kind = RELATION.sharedTag;
    }

    out[i] = kind;
  }
}

export interface RelationCounts {
  sameAuthor: number;
  sameSubject: number;
  sharedTag: number;
}

/** Books related to the hovered one, grouped for the tooltip/legend. */
export function relationCounts(relations: Float32Array): RelationCounts {
  let sameAuthor = 0;
  let sameSubject = 0;
  let sharedTag = 0;
  for (const v of relations) {
    if (v === RELATION.sameAuthor) sameAuthor++;
    else if (v === RELATION.sameSubject) sameSubject++;
    else if (v === RELATION.sharedTag) sharedTag++;
  }
  return { sameAuthor, sameSubject, sharedTag };
}
