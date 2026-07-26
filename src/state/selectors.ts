import type { Book, TagMap, TaxonomyIndex } from '@/domain/types';
import { RELATION, type RelationKind } from '@/domain/palette';
import { nodesForBook } from '@/domain/taxonomy';

/** Point visibility states written into the `aState` buffer attribute. */
export const POINT_STATE = {
  dim: 0,
  normal: 1,
  emphasized: 2,
} as const;

/** A taxonomy node covering more than this share of the corpus is too broad to
 *  earn the strong relation colour, however deep it sits.
 *
 *  Swept against the real corpus, trading books left with no coloured kin at all
 *  against how much of the cloud lights up in the worst case:
 *
 *    share  no-kin books   median hued   max hued
 *    0.06    40 (11.1%)         14        50 (13.9%)
 *    0.08    12  (3.3%)         26        81 (22.4%)   <- chosen
 *    0.10     0  (0.0%)         55       126 (34.9%)
 *    0.12     0  (0.0%)         61       141 (39.1%)
 *
 *  0.10 removes the last gap but lights up a third of the cloud, which is the
 *  wash this gate exists to prevent. 0.08 keeps the typical highlight at ~7% of
 *  the corpus. The 12 remaining books have genuinely broad subjects only, and
 *  still get the size cue from the `sharedTag` tier. */
export const SPECIFIC_NODE_MAX_SHARE = 0.08;

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
 *  only the points related to the cursor take a hue. That is what keeps the
 *  palette within its measured limits — see `domain/palette.ts`.
 *
 *  The tiers are graded by how much the shared node actually narrows things down:
 *
 *    sameAuthor  - shares an author
 *    sameSubject - shares a SPECIFIC leaf node (few enough members to mean something)
 *    sharedTag   - shares a leaf, but a common one
 *    none        - shares only a broader branch, which is barely a relation at all
 *
 *  Both subject tiers require an actual shared LEAF; they differ only in how
 *  common that leaf is. Sharing a mid-level branch (say "Life Sciences") is too
 *  weak to mark at all — allowing it put 46% of the corpus in some relation,
 *  which is noise rather than information.
 *
 *  Two earlier versions were wrong in opposite directions, both caught by
 *  measurement rather than reading:
 *
 *   - Defining `sharedTag` as "shares a raw tag" made it UNREACHABLE. Sharing a
 *     tag implies sharing the node that tag maps to, so `sameSubject` always
 *     matched first; the tier measured literally 0 for every book in the corpus.
 *   - Defining `sameSubject` as "shares any leaf" made it far too broad, because
 *     some leaves are common (memoir, war, political-theory each cover ~10% of
 *     the corpus). Hovering a memoir lit up 45% of the cloud.
 *
 *  Hence the member-count gate: a node covering a large share of the corpus does
 *  not earn the strong colour, however deep it sits in the taxonomy. */
export function computeRelationBuffer(
  books: Book[],
  hoveredId: string | null,
  tagMap: TagMap,
  taxonomy: TaxonomyIndex,
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

  const isLeaf = (nodeId: string): boolean =>
    (taxonomy.byId.get(nodeId)?.childIds.length ?? 0) === 0;

  const specificLimit = books.length * SPECIFIC_NODE_MAX_SHARE;
  const isSpecific = (nodeId: string): boolean =>
    (taxonomy.membersOf.get(nodeId)?.size ?? 0) <= specificLimit;

  const hoveredAuthors = new Set(hovered.authors);
  const hoveredLeaves = nodesForBook(hovered, tagMap).filter(isLeaf);

  // Leaves earning the strong colour, and the common leaves that only earn the
  // size cue.
  const hoveredSpecific = new Set(hoveredLeaves.filter(isSpecific));
  const hoveredCommon = new Set(hoveredLeaves.filter((n) => !isSpecific(n)));

  for (let i = 0; i < books.length; i++) {
    const book = books[i] as Book;
    if (book.id === hoveredId) {
      out[i] = RELATION.none;
      continue;
    }

    let kind: RelationKind = RELATION.none;

    // Checked strongest-first so a book matching several tiers shows the
    // strongest one.
    if (book.authors.some((a) => hoveredAuthors.has(a))) {
      kind = RELATION.sameAuthor;
    } else {
      const leaves = nodesForBook(book, tagMap).filter(isLeaf);
      if (leaves.some((n) => hoveredSpecific.has(n))) {
        kind = RELATION.sameSubject;
      } else if (leaves.some((n) => hoveredCommon.has(n))) {
        kind = RELATION.sharedTag;
      }
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
