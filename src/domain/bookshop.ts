import type { Book } from './types';
import { resolveIsbn13 } from './isbn';

/** Bookshop.org purchase links.
 *
 *  Bookshop routes the bulk of its margin to independent bookshops, which is a
 *  different thing to be sending readers into than Amazon was.
 *
 *  Deliberately NOT implemented: any claim about price, stock or availability.
 *  Nothing here knows whether a given book is in Bookshop's catalogue, so
 *  nothing here says it is — the link opens their page and their page reports
 *  what they have. The claim is never ours. */

export type BookshopLinkKind = 'product' | 'search';

export interface BookshopLink {
  href: string;
  kind: BookshopLinkKind;
  /** Honest label. A product link can still 404 for an out-of-print title, so
   *  it never promises availability. */
  label: string;
  /** Sub-label describing exactly what the link opens. */
  hint: string;
  /** True when the URL carries affiliate attribution, so the caller can decide
   *  whether `rel="sponsored"` is accurate. Marking a link sponsored when no
   *  commission can arise is a misstatement, just a quiet one. */
  sponsored: boolean;
}

const HOST = 'https://bookshop.org';

/** Bookshop's search path.
 *
 *  UNVERIFIED FROM THIS ENVIRONMENT: `bookshop.org` answers 403 at the egress
 *  proxy of the sandbox this was written in, so no request has ever been made
 *  against it.
 *
 *  And unlike the Amazon Prime refinement this replaces, IT DOES NOT FAIL SAFE.
 *  An unrecognised search *refinement* degrades to ordinary results; a wrong
 *  search *path* is a 404 on every button in the app. It is also the cheapest
 *  possible thing to confirm — click one button — and a one-line fix if wrong.
 *  Flagged here rather than buried, because "the whole feature is broken" and
 *  "one link is slightly off" deserve different amounts of attention. */
const SEARCH_PATH = '/beta-search';

/** Build a purchase link for a book.
 *
 *  - ISBN-13 available -> `/a/{affiliateID}/{isbn13}`, Bookshop's documented
 *    affiliate product link, or `/book/{isbn13}` with no affiliate configured.
 *  - Otherwise -> a search for title and author.
 *
 *  Which branch a book takes is decided by its DATA, not by anything here. A book
 *  with an `isbn13` deep-links to its own page; a book without one searches. The
 *  corpus was authored by hand and recorded no ISBNs at all, which is the only
 *  reason every link was a search — `npm run isbn:enrich` fills them in from Open
 *  Library, and every book it resolves moves to the first branch on the next bake.
 *
 *  Books the enrichment pass cannot confidently identify keep the search link on
 *  purpose. A search that finds the book beats a product link that 404s, and beats
 *  a convincing page for the wrong book by much more than that.
 *
 *  Affiliate attribution is a PATH SEGMENT for Bookshop, not a query parameter
 *  the way Amazon's `tag` was. With no id configured the link is a plain
 *  bookshop.org URL and carries no attribution at all. */
export function bookshopLinkForBook(book: Book, affiliateId?: string): BookshopLink {
  const id = affiliateId?.trim() || undefined;
  const isbn13 = resolveIsbn13(book);

  if (isbn13) {
    return {
      href: id ? `${HOST}/a/${encodeURIComponent(id)}/${isbn13}` : `${HOST}/book/${isbn13}`,
      kind: 'product',
      label: 'Buy on Bookshop.org',
      hint: 'opens the book on Bookshop.org',
      sponsored: id !== undefined,
    };
  }

  const url = new URL(`${HOST}${SEARCH_PATH}`);
  url.searchParams.set('keywords', `${book.title} ${book.authors[0] ?? ''}`.trim());
  return {
    href: url.toString(),
    kind: 'search',
    label: 'Find on Bookshop.org',
    // Says what the link ASKS FOR, not what is guaranteed to come back.
    hint: 'opens a Bookshop.org search for this title',
    // A search URL cannot carry the `/a/{id}` segment, so it is never attributed
    // and must never be marked sponsored. That is not a limitation to work
    // around — it is the accurate description of the link.
    sponsored: false,
  };
}

/** Read the affiliate id from the Vite env. Absent unless configured, which is
 *  fine — links simply carry no attribution. */
export function configuredAffiliateId(): string | undefined {
  const raw = import.meta.env?.VITE_BOOKSHOP_AFFILIATE_ID as string | undefined;
  return raw?.trim() || undefined;
}

/** Affiliate programmes require a visible disclosure wherever affiliate links
 *  appear. Rendered in the footer — but ONLY when there is an affiliate
 *  relationship to disclose.
 *
 *  The Amazon version of this was rendered unconditionally, so the app told
 *  every visitor it earned commission on their purchases while carrying no
 *  affiliate tag at all and earning nothing. A disclosure that is false is not a
 *  harmless extra: it is a claim about a commercial relationship that does not
 *  exist. */
export const AFFILIATE_DISCLOSURE =
  'Purchases made through links on this page may earn a commission, which supports independent bookshops.';

export function shouldDiscloseAffiliate(affiliateId = configuredAffiliateId()): boolean {
  return affiliateId !== undefined;
}
