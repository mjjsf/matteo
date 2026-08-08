import { AFFILIATE_DISCLOSURE, shouldDiscloseAffiliate } from '@/domain/bookshop';
import { useStore } from '@/state/store';

/** The site line, carrying what used to sit under the landing input as well.
 *
 *  Those two lines said the same thing — the footer read "N books · neighbours
 *  from shared subjects and authors" while the landing screen read "N books,
 *  mapped by shared subjects and authors", one above the other on the same
 *  screen. This is the surviving copy, so the wording is the landing screen's.
 *
 *  `showBrowse` exists only for the Browse screen: the link came along with the
 *  text, and pointing it at the page you are already on is dead weight. */
export function Footer({ showBrowse = true }: { showBrowse?: boolean }): React.ReactElement {
  const count = useStore((s) => s.books.length);
  const ready = useStore((s) => s.status === 'ready');

  return (
    <footer className="footer">
      {/* The count is 0 until the corpus lands, and the footer is on screen for
          that whole window — so state the fact only once it is one. */}
      <span>
        {ready
          ? `${count} books, mapped by shared subjects and authors.`
          : 'Books mapped by shared subjects and authors.'}
        {showBrowse && (
          <>
            {' '}
            <a className="footer__browse" href="#/browse">
              Browse the collection
            </a>
          </>
        )}
      </span>
      {/* Only when there is a relationship to disclose. This used to render
          unconditionally, so the app told every visitor it earned commission on
          their purchases while carrying no affiliate id and earning nothing. */}
      {shouldDiscloseAffiliate() && (
        <span className="footer__disclosure">{AFFILIATE_DISCLOSURE}</span>
      )}
    </footer>
  );
}
