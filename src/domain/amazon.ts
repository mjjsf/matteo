import type { Book } from './types';
import { resolveIsbn10 } from './isbn';

/** Amazon purchase links.
 *
 *  Deliberately NOT implemented: any Prime-eligibility badge. Real Prime status
 *  requires the Product Advertising API (PA-API 5.0), which needs an approved
 *  Associates account and secret-key request signing that cannot happen in a
 *  browser. Displaying a Prime badge we have not verified would be fabricating
 *  data about a real product, so the UI says nothing about shipping and lets
 *  Amazon's own page report it. */

export type AmazonLinkKind = 'dp' | 'search';

export interface AmazonLink {
  href: string;
  kind: AmazonLinkKind;
  /** Honest label. A `/dp/` link can still 404 for out-of-print titles, and an
   *  ISBN-10 is not universally the ASIN, so we never promise availability. */
  label: string;
}

const HOST = 'https://www.amazon.com';

/** Build a purchase link for a book.
 *  - 978-prefixed ISBN available -> `/dp/{isbn10}` deep link.
 *  - Otherwise (no ISBN, or a 979 prefix which has no ISBN-10) -> search URL.
 *  The associate tag is omitted entirely when unset; never `tag=undefined`. */
export function amazonLinkForBook(book: Book, associateTag?: string): AmazonLink {
  const tag = associateTag?.trim() || undefined;
  const isbn10 = resolveIsbn10(book);

  if (isbn10) {
    const url = new URL(`${HOST}/dp/${isbn10}`);
    if (tag) url.searchParams.set('tag', tag);
    return { href: url.toString(), kind: 'dp', label: 'Buy on Amazon' };
  }

  const url = new URL(`${HOST}/s`);
  url.searchParams.set('k', `${book.title} ${book.authors[0] ?? ''}`.trim());
  url.searchParams.set('i', 'stripbooks');
  if (tag) url.searchParams.set('tag', tag);
  return { href: url.toString(), kind: 'search', label: 'Find on Amazon' };
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
