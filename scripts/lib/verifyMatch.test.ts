import { describe, expect, it } from 'vitest';
import type { Book } from '@/domain/types';
import {
  bestMatch,
  normaliseTitle,
  sameSurname,
  surnameOf,
  verify,
  type CatalogueRecord,
} from './verifyMatch';

const book = (over: Partial<Book> = {}): Book => ({
  id: 'neuromancer',
  title: 'Neuromancer',
  authors: ['William Gibson'],
  year: 1984,
  subjects: ['cyberpunk', 'noir'],
  description: 'x'.repeat(100),
  ...over,
});

const record = (over: Partial<CatalogueRecord> = {}): CatalogueRecord => ({
  title: 'Neuromancer',
  authors: ['William Gibson'],
  year: 1984,
  ...over,
});

describe('titles agree across catalogues', () => {
  it('ignores a subtitle the corpus does not carry', () => {
    // The single most common benign difference. Catalogue records routinely
    // append one; the corpus never does.
    expect(normaliseTitle('The Brothers Karamazov: A Novel in Four Parts')).toBe(
      normaliseTitle('The Brothers Karamazov'),
    );
  });

  it('ignores a leading article, matching what search already does', () => {
    expect(normaliseTitle('The Dispossessed')).toBe(normaliseTitle('Dispossessed'));
  });

  it('ignores diacritics, case and punctuation', () => {
    expect(normaliseTitle('Les Misérables')).toBe(normaliseTitle('les miserables'));
    expect(normaliseTitle("Gravity's Rainbow")).toBe(normaliseTitle('Gravitys Rainbow'));
  });

  it('still tells two different books apart', () => {
    expect(normaliseTitle('The Trial')).not.toBe(normaliseTitle('The Castle'));
  });
});

describe('authors agree across catalogues', () => {
  it('reads a surname out of every form a catalogue uses', () => {
    expect(surnameOf('Ursula K. Le Guin')).toBe('guin');
    expect(surnameOf('Le Guin, Ursula K.')).toBe('guin');
    expect(surnameOf('U. K. Le Guin')).toBe('guin');
  });

  it('accepts a transliteration that differs by a character', () => {
    // Real disagreements between catalogues, all the same writer.
    expect(sameSurname('dostoevsky', 'dostoyevsky')).toBe(true);
    expect(sameSurname('tolstoy', 'tolstoi')).toBe(true);
    expect(sameSurname('chekhov', 'chekov')).toBe(true);
  });

  it('does NOT accept a one-character difference in a short name', () => {
    // The reason the tolerance is length-gated. At four or five letters, one
    // character apart is a different person, and a verification pass that waves
    // those through is not verifying anything.
    expect(sameSurname('wolf', 'woolf')).toBe(false);
    expect(sameSurname('mann', 'munn')).toBe(false);
    expect(sameSurname('bronte', 'brontes')).toBe(true);
  });

  it('refuses to match an empty name against anything', () => {
    expect(sameSurname('', '')).toBe(false);
    expect(sameSurname('gibson', '')).toBe(false);
  });
});

describe('picking which record to compare against', () => {
  it('prefers the record that agrees on the author', () => {
    // `The Trial` is at least four different books. Comparing against whichever
    // one the catalogue ranked first would report the corpus as wrong about a
    // book it is right about.
    const records = [
      record({ title: 'The Trial', authors: ['Robert Whitlow'], year: 2001 }),
      record({ title: 'The Trial', authors: ['Franz Kafka'], year: 1925 }),
    ];
    const chosen = bestMatch(book({ title: 'The Trial', authors: ['Franz Kafka'], year: 1925 }), records);
    expect(chosen?.authors).toEqual(['Franz Kafka']);
  });

  it('prefers a record that matches with its subtitle intact', () => {
    // The tension the ranking exists to resolve, in both directions. Cutting the
    // subtitle is what lets the corpus match a catalogue record that carries
    // one; the same cut makes `Neuromancer: The Graphic Novel` — a different
    // work, by the same author, so the author check cannot save us — look like
    // `Neuromancer`. Listed first, so a filter would have taken it.
    const records = [record({ title: 'Neuromancer: The Graphic Novel', year: 1989 }), record()];
    expect(bestMatch(book(), records)?.year).toBe(1984);
  });

  it('still matches through a subtitle when nothing better is on offer', () => {
    const records = [
      record({ title: 'The Brothers Karamazov: A Novel in Four Parts', authors: ['Fyodor Dostoyevsky'], year: 1880 }),
    ];
    const target = book({ title: 'The Brothers Karamazov', authors: ['Fyodor Dostoevsky'], year: 1880 });
    expect(bestMatch(target, records)?.year).toBe(1880);
    expect(verify(target, records)).toEqual({ kind: 'ok' });
  });

  it('finds nothing when nothing has the title', () => {
    expect(bestMatch(book(), [record({ title: 'Count Zero' })])).toBeUndefined();
  });
});

describe('the verdict', () => {
  it('passes a book the catalogue agrees with', () => {
    expect(verify(book(), [record()])).toEqual({ kind: 'ok' });
  });

  it('reports a book the catalogue has never heard of', () => {
    // The finding that matters most: the strongest available signal that an
    // entry is not a real book.
    expect(verify(book(), []).kind).toBe('not-found');
    expect(verify(book(), [record({ title: 'Something Else' })]).kind).toBe('not-found');
  });

  it('reports a title the catalogue attributes to someone else', () => {
    const verdict = verify(book(), [record({ authors: ['Bruce Sterling'] })]);
    expect(verdict).toEqual({
      kind: 'author-differs',
      expected: ['William Gibson'],
      found: ['Bruce Sterling'],
    });
  });

  it('separates the two directions a year can disagree in', () => {
    // Not one "year mismatch" bucket. A corpus year EARLIER than the catalogue's
    // is the ordinary translation case — War and Peace is 1869 in Russian and
    // 1886 in English, and 1869 is the right answer. A corpus year LATER than
    // the catalogue's earliest record is the one worth looking at, because it
    // claims the book is newer than the catalogue's own first sighting of it.
    expect(verify(book({ year: 1869 }), [record({ year: 1886 })])).toEqual({
      kind: 'year-earlier',
      expected: 1869,
      found: 1886,
    });
    expect(verify(book({ year: 1999 }), [record({ year: 1984 })])).toEqual({
      kind: 'year-later',
      expected: 1999,
      found: 1984,
    });
  });

  it('lets a year slide by one, which is an edition boundary not an error', () => {
    expect(verify(book({ year: 1983 }), [record({ year: 1984 })]).kind).toBe('ok');
    expect(verify(book({ year: 1985 }), [record({ year: 1984 })]).kind).toBe('ok');
    expect(verify(book({ year: 1986 }), [record({ year: 1984 })]).kind).not.toBe('ok');
  });

  it('does not invent a year disagreement when the catalogue has no year', () => {
    const { year: _drop, ...noYear } = record();
    expect(verify(book(), [noYear]).kind).toBe('ok');
  });

  it('checks the author before the year, because it is the worse problem', () => {
    const verdict = verify(book({ year: 1999 }), [record({ authors: ['Bruce Sterling'], year: 1984 })]);
    expect(verdict.kind).toBe('author-differs');
  });
});
