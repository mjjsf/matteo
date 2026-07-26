/** ISBN normalisation and conversion.
 *
 *  Why this exists: Amazon's `/dp/{ASIN}` deep links work for print books when
 *  the ASIN equals the ISBN-10. Getting an ISBN-10 out of a corpus that records
 *  ISBN-13 requires a real conversion, including the check digit.
 *
 *  The important edge case: ISBN-13s in the **979** prefix range have no
 *  ISBN-10 equivalent at all — the ISBN-10 space simply cannot represent them.
 *  Only 978-prefixed ISBN-13s convert. Callers must handle `null`. */

/** Strip hyphens, spaces, and normalise a trailing lowercase 'x'. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

function isbn10CheckDigit(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (10 - i) * Number(first9[i]);
  }
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn10(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  return isbn10CheckDigit(s.slice(0, 9)) === s[9];
}

export function isValidIsbn13(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (!/^\d{13}$/.test(s)) return false;
  return isbn13CheckDigit(s.slice(0, 12)) === s[12];
}

export function isValidIsbn(raw: string): boolean {
  return isValidIsbn10(raw) || isValidIsbn13(raw);
}

/** Convert a 978-prefixed ISBN-13 to its ISBN-10 form.
 *  Returns null for 979 prefixes (no ISBN-10 exists), invalid checksums, or
 *  anything malformed — never throws, so callers can fall back to a search URL. */
export function isbn13ToIsbn10(raw: string): string | null {
  const s = normalizeIsbn(raw);
  if (!/^\d{13}$/.test(s)) return null;
  if (!s.startsWith('978')) return null;
  if (isbn13CheckDigit(s.slice(0, 12)) !== s[12]) return null;

  const body = s.slice(3, 12);
  return body + isbn10CheckDigit(body);
}

/** Best available ISBN-10 for a book: an explicit one if present and valid,
 *  otherwise derived from a 978 ISBN-13. Null when neither is possible. */
export function resolveIsbn10(book: {
  isbn10?: string;
  isbn13?: string;
}): string | null {
  if (book.isbn10) {
    const s = normalizeIsbn(book.isbn10);
    if (isValidIsbn10(s)) return s;
  }
  if (book.isbn13) return isbn13ToIsbn10(book.isbn13);
  return null;
}
