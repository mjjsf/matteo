import { describe, expect, it } from 'vitest';
import graphIndexJson from '@/generated/graph-index.json';
import corpusJson from '@/generated/corpus.json';
import type { Book } from './types';
import {
  isAncestorTopic,
  topicPathForTag,
  type GraphIndexFile,
} from './graphIndex';

const index = graphIndexJson as unknown as GraphIndexFile;
const books = corpusJson as unknown as Book[];
const titleOf = new Map(books.map((b) => [b.id, b.title]));
const titles = (ids: string[] | undefined, n = 8): string[] =>
  (ids ?? []).slice(0, n).map((id) => titleOf.get(id) ?? id);

describe('hierarchy comes from the authored taxonomy', () => {
  it('nests broad above narrow, never the reverse', () => {
    // THE guard test. Deriving hierarchy from tag co-occurrence produced these
    // relations INVERTED — `epic-fantasy` came out as the parent of `fantasy`
    // at 0.83, `ethics` as the parent of `philosophy` at 0.56 — because tag
    // assignment is not hierarchical and the conditional probabilities flip.
    // If someone "improves" this back to statistics, this fails loudly.
    const cases: Array<[string, string]> = [
      ['spec', 'spec-fantasy'],
      ['spec-fantasy', 'spec-fantasy-epic'],
      ['philosophy', 'philosophy-western'],
      ['philosophy-western', 'philosophy-western-existentialism'],
    ];
    for (const [broad, narrow] of cases) {
      expect(isAncestorTopic(index, broad, narrow), `${broad} should contain ${narrow}`).toBe(true);
      expect(isAncestorTopic(index, narrow, broad), `${narrow} must NOT contain ${broad}`).toBe(
        false,
      );
    }
  });

  it('walks from a leaf tag up to a root', () => {
    const path = topicPathForTag(index, 'existentialism');
    expect(path[0]).toBe('philosophy-western-existentialism');
    expect(path.at(-1)).toBe('philosophy');
    expect(index.rootTopics).toContain(path.at(-1));
  });

  it('lets a tag sit under more than one topic rather than forcing a parent', () => {
    // 16 of 227 tags genuinely classify two ways. Picking one would assert a
    // containment the authored data deliberately declines to make.
    const multi = Object.entries(index.topicsForTag).filter(([, t]) => t.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    expect(index.topicsForTag['totalitarianism']).toEqual(
      expect.arrayContaining(['spec-sf-dystopia', 'society-politics-authoritarianism']),
    );
  });

  it('has no topic pointing at a parent that does not exist', () => {
    for (const [id, node] of Object.entries(index.topics)) {
      if (node.parentId === null) continue;
      expect(index.topics[node.parentId], `${id} has a dangling parent`).toBeDefined();
    }
  });
});

describe('books under a subject are the ones it describes', () => {
  it('ranks the philosophy above the novels for existentialism', () => {
    // The failure mode of a naive inverted index: `existentialism` is carried by
    // Kafka, Murakami and Dostoevsky as well as by Sartre and Heidegger, and
    // insertion order would put the novels first.
    const top = titles(index.booksForTag['existentialism'], 5);
    expect(top).toContain('Being and Time');
    expect(top).toContain('Being and Nothingness');
    expect(top).not.toContain('Kafka on the Shore');
  });

  it('keeps a very broad tag from returning arbitrary books', () => {
    // `book-club` is on 157 books. Every one of them must at least carry the tag.
    const ids = index.booksForTag['book-club'] ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(books.find((b) => b.id === id)?.subjects).toContain('book-club');
    }
  });

  it('ranks a topic by how much of a book falls inside it', () => {
    // Scoring a book by its single strongest tag put Legendborn — a YA fantasy
    // with one philosophy-adjacent tag — sixth under Philosophy & Religion.
    // Summing across the topic's tags asks the right question.
    const top = titles(index.booksForTopic['philosophy'], 6);
    expect(top).not.toContain('Legendborn');
    expect(top.some((t) => /Being and Time|Fear and Trembling|Philosophical Investigations/.test(t))).toBe(
      true,
    );
  });

  it('lists every book it names, and never one that does not exist', () => {
    const known = new Set(books.map((b) => b.id));
    for (const ids of [
      ...Object.values(index.booksForTag),
      ...Object.values(index.booksForTopic),
      ...Object.values(index.booksForAuthor),
    ]) {
      for (const id of ids) expect(known.has(id)).toBe(true);
    }
  });
});

describe('related, where correlation is the right relation', () => {
  it('relates a tag to tags that actually co-occur', () => {
    expect(index.relatedTags['cyberpunk']).toEqual(
      expect.arrayContaining(['artificial-intelligence']),
    );
    expect(index.relatedTags['cyberpunk']).not.toContain('cyberpunk');
  });

  it('relates authors through their books, not through tiny subject sets', () => {
    // Cosine over each author's subject set returned Daphne du Maurier and Mary
    // Wollstonecraft as Le Guin's nearest, because a one-book author with two
    // shared tags outscored a real match.
    const near = (index.relatedAuthors['ursula-k-le-guin'] ?? []).map(
      (s) => index.authorNames[s],
    );
    expect(near.length).toBeGreaterThan(0);
    expect(near).not.toContain('Mary Wollstonecraft');
  });

  it('offers related authors only where there is an author-shaped relation', () => {
    // A one-book author's "related authors" is a restatement of that book's own
    // neighbours, so it is not stored — the axis is simply not offered.
    for (const [slug, related] of Object.entries(index.relatedAuthors)) {
      expect((index.booksForAuthor[slug] ?? []).length).toBeGreaterThan(1);
      expect(related.every((s) => s !== slug)).toBe(true);
    }
  });

  it('names every author it relates', () => {
    for (const [slug, related] of Object.entries(index.relatedAuthors)) {
      expect(index.authorNames[slug]).toBeTruthy();
      for (const other of related) expect(index.authorNames[other]).toBeTruthy();
    }
  });
});
