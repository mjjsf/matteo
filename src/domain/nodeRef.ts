/** What a node on the map refers to.
 *
 *  The map used to hold one kind of thing — a book — so a node's identity was a
 *  bare book id. It now holds four grains, and they have to coexist in one
 *  `Graph.indexOf: Map<string, number>` because that map is what makes an array
 *  index also the vertex slot, the buffer offset and the edge endpoint.
 *
 *  So identity stays a single string, namespaced: `book:neuromancer`,
 *  `topic:philosophy-western`, `tag:existentialism`, `author:ursula-k-le-guin`.
 *  Every slot mechanism keeps working untouched, and the URL carries the grain
 *  for free.
 *
 *  `topic` and `tag` are deliberately separate. A topic is an authored taxonomy
 *  node — the hierarchy. A tag is a raw subject string, which is what the pills
 *  in the detail panel are. Conflating them would mean either inventing taxonomy
 *  nodes for 227 tags or pretending the taxonomy's 145 curated nodes are
 *  interchangeable with them. They render as one visual kind; they are not one
 *  kind of thing. */

export type NodeKind = 'book' | 'topic' | 'tag' | 'author';

/** Namespaced node identity. Branded so a bare book id cannot be passed where a
 *  ref is expected — the same protection `Slot` gives against index confusion,
 *  and for the same reason: the failure is silent, not loud. */
export type NodeRef = string & { readonly __brand: 'NodeRef' };

export interface ParsedRef {
  kind: NodeKind;
  /** The part after the prefix: a book id, taxonomy node id, tag, or author slug. */
  id: string;
}

const KINDS: readonly NodeKind[] = ['book', 'topic', 'tag', 'author'];

export const bookRef = (id: string): NodeRef => `book:${id}` as NodeRef;
export const topicRef = (id: string): NodeRef => `topic:${id}` as NodeRef;
export const tagRef = (tag: string): NodeRef => `tag:${tag}` as NodeRef;
export const authorRef = (slug: string): NodeRef => `author:${slug}` as NodeRef;

/** Parse a ref, or null if it is not one.
 *
 *  A bare id with no prefix is read as a book. That is not laxness: every URL
 *  shared before this change carries bare book ids, and they must keep
 *  resolving. */
export function parseRef(ref: string): ParsedRef | null {
  const at = ref.indexOf(':');
  if (at === -1) return ref ? { kind: 'book', id: ref } : null;
  const kind = ref.slice(0, at) as NodeKind;
  const id = ref.slice(at + 1);
  if (!KINDS.includes(kind) || !id) return null;
  return { kind, id };
}

/** Normalise anything ref-shaped into a real `NodeRef`, or null. */
export function toRef(ref: string): NodeRef | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  return `${parsed.kind}:${parsed.id}` as NodeRef;
}

export function kindOf(ref: NodeRef): NodeKind {
  return parseRef(ref)?.kind ?? 'book';
}

export function idOf(ref: NodeRef): string {
  return parseRef(ref)?.id ?? ref;
}

export const isBook = (ref: NodeRef): boolean => kindOf(ref) === 'book';

/** Stable slug for an author name.
 *
 *  Authors have no ids in this corpus — only names on books — so the slug IS the
 *  identity, and two different writers colliding on one slug would silently
 *  merge two bodies of work into one node. A guard test asserts uniqueness
 *  across the corpus rather than trusting this to be injective. */
export function authorSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
