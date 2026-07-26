import { describe, expect, it } from 'vitest';
import {
  isValidIsbn10,
  isValidIsbn13,
  isbn13ToIsbn10,
  normalizeIsbn,
  resolveIsbn10,
} from './isbn';

describe('normalizeIsbn', () => {
  it('strips hyphens and spaces and upcases the check digit', () => {
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(normalizeIsbn(' 0 306 40615 2 ')).toBe('0306406152');
    expect(normalizeIsbn('043942089x')).toBe('043942089X');
  });
});

describe('isbn13ToIsbn10', () => {
  it('converts the canonical pair', () => {
    expect(isbn13ToIsbn10('9780306406157')).toBe('0306406152');
  });

  it('tolerates hyphens and spaces', () => {
    expect(isbn13ToIsbn10('978-0-306-40615-7')).toBe('0306406152');
  });

  it('produces an X check digit where required', () => {
    // 978-0-8044-2957-X: the ISBN-10 check digit for body 080442957 is X.
    const isbn10 = isbn13ToIsbn10('9780804429573');
    expect(isbn10).toBe('080442957X');
    expect(isValidIsbn10(isbn10 as string)).toBe(true);
  });

  it('returns null for 979 prefixes, which have no ISBN-10 at all', () => {
    // Assert the checksum is genuinely valid first, so this test proves the
    // 979 prefix is the reason for rejection rather than a malformed number.
    expect(isValidIsbn13('9791234567896')).toBe(true);
    expect(isbn13ToIsbn10('9791234567896')).toBeNull();
  });

  it('returns null rather than throwing on malformed input', () => {
    for (const bad of ['', 'not-an-isbn', '97803064061', '97803064061579', '978030640615X']) {
      expect(isbn13ToIsbn10(bad)).toBeNull();
    }
  });

  it('returns null when the ISBN-13 checksum is wrong', () => {
    expect(isbn13ToIsbn10('9780306406158')).toBeNull();
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

describe('resolveIsbn10', () => {
  it('prefers an explicit valid isbn10', () => {
    expect(resolveIsbn10({ isbn10: '0306406152', isbn13: '9791234567896' })).toBe('0306406152');
  });

  it('derives from isbn13 when isbn10 is absent', () => {
    expect(resolveIsbn10({ isbn13: '9780306406157' })).toBe('0306406152');
  });

  it('ignores an invalid explicit isbn10 and falls back', () => {
    expect(resolveIsbn10({ isbn10: 'garbage', isbn13: '9780306406157' })).toBe('0306406152');
  });

  it('returns null when nothing is resolvable', () => {
    expect(resolveIsbn10({})).toBeNull();
    expect(resolveIsbn10({ isbn13: '9791234567896' })).toBeNull();
  });
});
