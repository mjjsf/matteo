import { describe, expect, it } from 'vitest';
import corpusJson from '@/generated/corpus.json';
import type { Book } from './types';
import {
  authorRef,
  authorSlug,
  bookRef,
  idOf,
  kindOf,
  parseRef,
  tagRef,
  topicRef,
  toRef,
} from './nodeRef';

describe('parseRef', () => {
  it('round-trips every kind', () => {
    for (const ref of [
      bookRef('neuromancer'),
      topicRef('philosophy-western'),
      tagRef('existentialism'),
      authorRef('ursula-k-le-guin'),
    ]) {
      const parsed = parseRef(ref);
      expect(parsed).not.toBeNull();
      expect(`${parsed?.kind}:${parsed?.id}`).toBe(ref);
      expect(kindOf(ref)).toBe(parsed?.kind);
      expect(idOf(ref)).toBe(parsed?.id);
    }
  });

  it('reads a bare id as a book', () => {
    // Load-bearing: every URL shared before node kinds existed carries one.
    expect(parseRef('neuromancer')).toEqual({ kind: 'book', id: 'neuromancer' });
    expect(toRef('neuromancer')).toBe(bookRef('neuromancer'));
  });

  it('rejects an unknown kind rather than inventing one', () => {
    expect(parseRef('planet:arrakis')).toBeNull();
    expect(toRef('planet:arrakis')).toBeNull();
  });

  it('rejects an empty ref and an empty id', () => {
    expect(parseRef('')).toBeNull();
    expect(parseRef('book:')).toBeNull();
  });

  it('keeps a colon that belongs to the id', () => {
    // Book ids and tags are slugs today, but a title-derived id containing a
    // colon must not be truncated at the wrong separator.
    expect(parseRef('book:a:b')).toEqual({ kind: 'book', id: 'a:b' });
  });
});

describe('authorSlug', () => {
  it('folds case, accents and punctuation', () => {
    expect(authorSlug('Ursula K. Le Guin')).toBe('ursula-k-le-guin');
    expect(authorSlug('Gabriel García Márquez')).toBe('gabriel-garcia-marquez');
    expect(authorSlug('  Trailing  ')).toBe('trailing');
  });

  it('is unique across every author in the corpus', () => {
    // The slug IS the identity — authors have no ids in this corpus, only names
    // on books. Two writers colliding on one slug would silently merge two
    // bodies of work into a single node, with no error and no visible symptom.
    const byslug = new Map<string, Set<string>>();
    for (const book of corpusJson as unknown as Book[]) {
      for (const name of book.authors) {
        const slug = authorSlug(name);
        const names = byslug.get(slug) ?? new Set<string>();
        names.add(name);
        byslug.set(slug, names);
      }
    }
    const collisions = [...byslug.entries()].filter(([, names]) => names.size > 1);
    expect(collisions.map(([slug, names]) => `${slug}: ${[...names].join(' / ')}`)).toEqual([]);
  });

  it('never produces an empty slug for a real author name', () => {
    for (const book of corpusJson as unknown as Book[]) {
      for (const name of book.authors) {
        expect(authorSlug(name), `"${name}" slugged to nothing`).not.toBe('');
      }
    }
  });
});
