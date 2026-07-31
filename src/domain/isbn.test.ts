import { describe, expect, it } from 'vitest';
import {
  isValidIsbn10,
  isValidIsbn13,
  isbn10ToIsbn13,
  normalizeIsbn,
  resolveIsbn13,
} from './isbn';

describe('normalizeIsbn', () => {
  it('strips hyphens and spaces and upcases the check digit', () => {
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(normalizeIsbn(' 0 306 40615 2 ')).toBe('0306406152');
    expect(normalizeIsbn('043942089x')).toBe('043942089X');
  });
});

describe('isbn10ToIsbn13', () => {
  it('converts the canonical pair', () => {
    expect(isbn10ToIsbn13('0306406152')).toBe('9780306406157');
  });

  it('tolerates hyphens and spaces', () => {
    expect(isbn10ToIsbn13('0-306-40615-2')).toBe('9780306406157');
  });

  it('accepts an X check digit and discards it', () => {
    // The two check digits are computed over different weightings and are not
    // related, so the 10's is dropped rather than carried across. 080442957X
    // and 0804429573 differ only in that digit and must produce the same 13.
    expect(isbn10ToIsbn13('080442957X')).toBe('9780804429573');
    expect(isValidIsbn13(isbn10ToIsbn13('080442957X') as string)).toBe(true);
  });

  it('returns null rather than throwing on malformed input', () => {
    for (const bad of ['', 'not-an-isbn', '030640615', '03064061522', '03064061X2']) {
      expect(isbn10ToIsbn13(bad)).toBeNull();
    }
  });

  it('returns null when the ISBN-10 checksum is wrong', () => {
    expect(isbn10ToIsbn13('0306406153')).toBeNull();
  });
});

describe('validation', () => {
  it('accepts correct ISBN-10s including the X form', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
  });

  it('rejects wrong ISBN-10 check digits', () => {
    expect(isValidIsbn10('0306406153')).toBe(false);
  });

  it('accepts correct ISBN-13s and rejects wrong ones', () => {
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isValidIsbn13('9780306406158')).toBe(false);
  });
});

describe('resolveIsbn13', () => {
  it('prefers an explicit valid isbn13', () => {
    expect(resolveIsbn13({ isbn10: '0306406152', isbn13: '9791234567896' })).toBe('9791234567896');
  });

  it('derives from isbn10 when isbn13 is absent', () => {
    expect(resolveIsbn13({ isbn10: '0306406152' })).toBe('9780306406157');
  });

  it('ignores an invalid explicit isbn13 and falls back', () => {
    expect(resolveIsbn13({ isbn13: 'garbage', isbn10: '0306406152' })).toBe('9780306406157');
  });

  it('keeps a 979 ISBN, which the old ISBN-10 direction had to reject', () => {
    expect(resolveIsbn13({ isbn13: '9791234567896' })).toBe('9791234567896');
  });

  it('returns null when nothing is resolvable', () => {
    expect(resolveIsbn13({})).toBeNull();
    expect(resolveIsbn13({ isbn10: 'garbage' })).toBeNull();
  });
});
