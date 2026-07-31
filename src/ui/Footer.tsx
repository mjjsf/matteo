import { AFFILIATE_DISCLOSURE, shouldDiscloseAffiliate } from '@/domain/bookshop';
import { useStore } from '@/state/store';

export function Footer(): React.ReactElement {
  const count = useStore((s) => s.books.length);
  const ready = useStore((s) => s.status === 'ready');

  return (
    <footer className="footer">
      {/* The count is 0 until the corpus lands, and the footer is on screen for
          that whole window — so state the fact only once it is one. */}
      <span>
        {ready ? `${count} books · ` : ''}neighbours from shared subjects and authors
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
