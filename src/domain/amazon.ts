import type { Book } from './types';
import { resolveIsbn10 } from './isbn';

/** Amazon purchase links.
 *
 *  Deliberately NOT implemented: any Prime-eligibility badge of our own. Real
 *  Prime status requires the Product Advertising API (PA-API 5.0), which needs
 *  an approved Associates account and secret-key request signing that cannot
 *  happen in a browser. Displaying a Prime badge we have not verified would be
 *  fabricating data about a real product.
 *
 *  What we do instead: hand Amazon a search URL that asks *Amazon* to filter to
 *  Prime-eligible results, and let its own page report what it finds. The claim
 *  is never ours. */

export type AmazonLinkKind = 'dp' | 'search';

export interface AmazonLink {
  href: string;
  kind: AmazonLinkKind;
  /** Honest label. A `/dp/` link can still 404 for out-of-print titles, and an
   *  ISBN-10 is not universally the ASIN, so we never promise availability. */
  label: string;
  /** Sub-label describing exactly what the link opens. */
  hint: string;
}

const HOST = 'https://www.amazon.com';

/** Amazon's search refinement for "Prime eligible", on the **US marketplace**.
 *
 *  UNVERIFIED FROM THIS ENVIRONMENT: `amazon.com` is unreachable from the build
 *  sandbox, so this value could not be exercised against the live site. It is an
 *  Amazon-internal refinement id and is marketplace-specific — the equivalent on
 *  amazon.co.uk or amazon.de is a different string.
 *
 *  Chosen to fail SAFE. An unrecognised `rh` refinement makes Amazon return the
 *  ordinary unfiltered search results for the same query, so the worst case is a
 *  normal book search rather than a broken page. Crucially, nothing on our side
 *  claims Prime eligibility, so a silently-ignored refinement cannot turn into a
 *  false claim — the user sees whatever Amazon actually shows. */
const PRIME_REFINEMENT_US = 'p_85:2470955011';

/** Build a purchase link for a book.
 *  - 978-prefixed ISBN available -> `/dp/{isbn10}` deep link.
 *  - Otherwise (no ISBN, or a 979 prefix which has no ISBN-10) -> search URL,
 *    asking Amazon to filter to Prime-eligible results.
 *  The associate tag is omitted entirely when unset; never `tag=undefined`. */
export function amazonLinkForBook(book: Book, associateTag?: string): AmazonLink {
  const tag = associateTag?.trim() || undefined;
  const isbn10 = resolveIsbn10(book);

  if (isbn10) {
    const url = new URL(`${HOST}/dp/${isbn10}`);
    if (tag) url.searchParams.set('tag', tag);
    return {
      href: url.toString(),
      kind: 'dp',
      label: 'Buy on Amazon',
      hint: 'opens the product page',
    };
  }

  const url = new URL(`${HOST}/s`);
  url.searchParams.set('k', `${book.title} ${book.authors[0] ?? ''}`.trim());
  url.searchParams.set('i', 'stripbooks');
  url.searchParams.set('rh', PRIME_REFINEMENT_US);
  if (tag) url.searchParams.set('tag', tag);
  return {
    href: url.toString(),
    kind: 'search',
    label: 'Find on Amazon',
    // Says what the link ASKS FOR, not what is guaranteed to come back.
    hint: 'opens an Amazon search filtered to Prime-eligible results',
  };
}

/** Read the associate tag from the Vite env. Absent in dev unless configured,
 *  which is fine — links simply carry no tag. */
export function configuredAssociateTag(): string | undefined {
  const raw = import.meta.env?.VITE_AMAZON_ASSOCIATE_TAG as string | undefined;
  return raw?.trim() || undefined;
}

/** Amazon's Associates operating agreement requires a visible disclosure
 *  wherever affiliate links appear. Rendered in the footer. */
export const AFFILIATE_DISCLOSURE =
  'As an Amazon Associate, purchases made through links on this page may earn a commission.';
