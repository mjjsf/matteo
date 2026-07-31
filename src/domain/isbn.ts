/** ISBN normalisation and conversion.
 *
 *  Why this exists: Bookshop.org's affiliate product link is
 *  `bookshop.org/a/{affiliateID}/{isbn13}`, so getting a valid ISBN-13 out of
 *  whatever a book happens to record is the difference between a deep link and a
 *  search.
 *
 *  This used to convert the other way, ISBN-13 to ISBN-10, because Amazon's
 *  `/dp/{ASIN}` deep links work for print books when the ASIN equals the
 *  ISBN-10. That direction is gone with the Amazon links, and with it the awkward
 *  edge case it carried: ISBN-13s in the **979** prefix range have no ISBN-10 at
 *  all, so only 978 prefixes converted. Going 10 to 13 has no such gap — every
 *  ISBN-10 has an ISBN-13, by construction. */

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

/** Convert an ISBN-10 to its ISBN-13 form.
 *  Returns null for an invalid checksum or anything malformed — never throws, so
 *  callers can fall back to a search URL. */
export function isbn10ToIsbn13(raw: string): string | null {
  const s = normalizeIsbn(raw);
  if (!isValidIsbn10(s)) return null;
  // The ISBN-10 check digit is discarded, not carried: the 13 recomputes its own
  // over a different weighting, and the two are not related.
  const body = `978${s.slice(0, 9)}`;
  return body + isbn13CheckDigit(body);
}

/** Best available ISBN-13 for a book: an explicit one if present and valid,
 *  otherwise derived from an ISBN-10. Null when neither is possible — which is
 *  every book in the corpus today, so the search fallback is the live path and
 *  not a rarity. */
export function resolveIsbn13(book: {
  isbn10?: string;
  isbn13?: string;
}): string | null {
  if (book.isbn13) {
    const s = normalizeIsbn(book.isbn13);
    if (isValidIsbn13(s)) return s;
  }
  if (book.isbn10) return isbn10ToIsbn13(book.isbn10);
  return null;
}
