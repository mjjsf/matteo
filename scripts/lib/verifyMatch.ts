import type { Book } from '@/domain/types';

/** Deciding whether a catalogue record is the same book as a corpus entry.
 *
 *  All of it pure, all of it tested, because this is where a verification pass
 *  either earns its keep or becomes noise. A check that reports two hundred
 *  false mismatches gets ignored on the first run and never opened again, and a
 *  check that is too lenient reports nothing and proves nothing.
 *
 *  Nothing here rewrites anything. The output is a verdict for a person to
 *  read. */

export interface CatalogueRecord {
  title: string;
  authors: string[];
  /** The catalogue's earliest known publication year, where it has one. */
  year?: number;
}

/** Strip diacritics, drop a leading article, cut a subtitle, remove
 *  punctuation.
 *
 *  Every one of these earns its place against the actual corpus: catalogue
 *  titles carry subtitles the corpus does not ("The Brothers Karamazov: A Novel
 *  in Four Parts"), and article handling has to match `search.ts`, which already
 *  strips them so that typing "brothers" finds the book. */
function flatten(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Apostrophes are REMOVED, not turned into a space, or "Gravity's Rainbow"
      // normalises to "gravity s rainbow" and stops matching the catalogue's
      // "Gravitys Rainbow".
      .replace(/['’‘`]/g, '')
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/** The whole title, subtitle included. */
export function normaliseTitleStrict(title: string): string {
  return flatten(title);
}

export function normaliseTitle(title: string): string {
  return flatten(title.split(/\s*[:;]\s*/)[0]!);
}

/** The last word of a name, which is the part two catalogues are most likely to
 *  agree on. Given names get initialised, reordered and abbreviated;
 *  "Ursula K. Le Guin" appears as "Le Guin, Ursula K." and as "U. K. Le Guin". */
export function surnameOf(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s,]/g, ' ')
    .trim();
  // "Le Guin, Ursula K." — inverted form, so the surname is before the comma.
  const beforeComma = cleaned.split(',')[0]!.trim();
  const parts = beforeComma.split(/\s+/).filter(Boolean);
  return parts.at(-1) ?? '';
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
}

/** Two surnames naming the same person.
 *
 *  Exact match after normalising, plus a small edit distance for names that came
 *  through transliteration — Dostoevsky/Dostoyevsky, Tolstoy/Tolstoi,
 *  Chekhov/Chekov all differ by one character and are the same writer. The
 *  tolerance is length-gated because at four letters an edit distance of one is
 *  a different person: Wolf and Woolf, Mann and Munn. */
export function sameSurname(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6) return false;
  return editDistance(a, b) <= 1;
}

export type Verdict =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'author-differs'; expected: string[]; found: string[] }
  /** The corpus year is EARLIER than the catalogue's earliest. Usually benign:
   *  a translated work dated by its original publication, where the catalogue
   *  knows only the English edition. */
  | { kind: 'year-earlier'; expected: number; found: number }
  /** The corpus year is LATER than the catalogue's earliest known publication.
   *  The more suspicious direction — it means we claim a book is newer than the
   *  catalogue's own first record of it. */
  | { kind: 'year-later'; expected: number; found: number };

/** A year difference small enough to be an edition or printing boundary rather
 *  than a claim about a different book. */
const YEAR_SLACK = 1;

/** Pick the catalogue record that is the same book, if any.
 *
 *  Ranked rather than filtered, because the two things that make a record a
 *  candidate pull in opposite directions.
 *
 *  Cutting the subtitle is what lets "The Brothers Karamazov" match a record
 *  titled "The Brothers Karamazov: A Novel in Four Parts". The same cut makes
 *  "Neuromancer: The Graphic Novel" — a genuinely different work — look like
 *  "Neuromancer". So a record that matches with its subtitle intact outranks one
 *  that only matches once the subtitle is gone, and agreeing on the author
 *  breaks the remaining ties. `The Trial` is at least four different books. */
export function bestMatch(book: Book, records: CatalogueRecord[]): CatalogueRecord | undefined {
  const strict = normaliseTitleStrict(book.title);
  const loose = normaliseTitle(book.title);
  const surnames = book.authors.map(surnameOf);

  let best: CatalogueRecord | undefined;
  let bestScore = 0;
  for (const candidate of records) {
    let score = 0;
    if (normaliseTitleStrict(candidate.title) === strict) score = 2;
    else if (normaliseTitle(candidate.title) === loose) score = 1;
    if (score === 0) continue;
    if (candidate.authors.some((a) => surnames.some((s) => sameSurname(s, surnameOf(a))))) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function verify(book: Book, records: CatalogueRecord[]): Verdict {
  const match = bestMatch(book, records);
  if (!match) return { kind: 'not-found' };

  const surnames = book.authors.map(surnameOf);
  const found = match.authors.map(surnameOf);
  if (!found.some((f) => surnames.some((s) => sameSurname(s, f)))) {
    return { kind: 'author-differs', expected: book.authors, found: match.authors };
  }

  if (typeof match.year === 'number' && Math.abs(match.year - book.year) > YEAR_SLACK) {
    return match.year > book.year
      ? { kind: 'year-earlier', expected: book.year, found: match.year }
      : { kind: 'year-later', expected: book.year, found: match.year };
  }

  return { kind: 'ok' };
}

/** One line per finding, grouped, so the report can be read rather than parsed.
 *
 *  Ordered by how much a human should care: a book the catalogue has never heard
 *  of is the strongest signal that an entry is not real, and a year that is
 *  merely earlier than the catalogue's is usually a translation. */
export const VERDICT_ORDER: Array<Exclude<Verdict['kind'], 'ok'>> = [
  'not-found',
  'author-differs',
  'year-later',
  'year-earlier',
];

export const VERDICT_NOTE: Record<Exclude<Verdict['kind'], 'ok'>, string> = {
  'not-found': 'No catalogue record with this title. Check the book exists as named.',
  'author-differs': 'Catalogue attributes this title to someone else.',
  'year-later': 'We date it after the catalogue does. Check the year.',
  'year-earlier':
    'We date it before the catalogue does. Usual cause is a translation dated by its ' +
    'original publication, which is correct — worth a glance, not alarm.',
};
