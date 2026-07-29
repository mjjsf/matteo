import { AFFILIATE_DISCLOSURE } from '@/domain/amazon';
import { useStore } from '@/state/store';

export function Footer(): React.ReactElement {
  const count = useStore((s) => s.books.length);

  return (
    <footer className="footer">
      <span>{count} books · neighbours from shared subjects and authors</span>
      <span className="footer__disclosure">{AFFILIATE_DISCLOSURE}</span>
    </footer>
  );
}
