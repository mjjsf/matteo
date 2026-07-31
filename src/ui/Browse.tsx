import { useMemo, useState } from 'react';
import { useStore, graphIndex } from '@/state/store';
import { authorRef, bookRef, tagRef, topicRef, type NodeRef } from '@/domain/nodeRef';

/** The collection as a list, not a map.
 *
 *  The map answers "what is near this". It cannot answer "what is in here at
 *  all", because it only ever shows the subgraph someone grew — so until now
 *  there was no way to see the collection, only to sample it through search.
 *
 *  Plain DOM by design. It is also a better no-WebGL entry point than an empty
 *  canvas, and it is the one screen where reading a long list is the task. */

type Mode = 'title' | 'subject' | 'author';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'title', label: 'By title' },
  { id: 'subject', label: 'By subject' },
  { id: 'author', label: 'By author' },
];

/** First character to file something under. Digits and symbols share a bucket
 *  rather than each getting a heading nobody scans for. */
function initial(label: string): string {
  const c = label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

function sortKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '');
}

export function Browse({ onClose }: { onClose: () => void }): React.ReactElement {
  const books = useStore((s) => s.books);
  const seed = useStore((s) => s.seed);
  const [mode, setMode] = useState<Mode>('title');

  const rows = useMemo(() => {
    const gi = graphIndex();
    let out: Array<{ ref: NodeRef; label: string; detail: string }> = [];

    if (mode === 'title') {
      out = books.map((b) => ({
        ref: bookRef(b.id),
        label: b.title,
        detail: `${b.authors.join(', ')} · ${b.year < 0 ? `${-b.year} BCE` : b.year}`,
      }));
    } else if (mode === 'subject' && gi) {
      // Topics first with their depth shown, then any tag that is not simply a
      // topic under another name — the same de-duplication search does, for the
      // same reason: one word twice is not two entries.
      const topicLabels = new Set(Object.values(gi.topics).map((t) => t.label.toLowerCase()));
      out = Object.entries(gi.topics).map(([id, t]) => ({
        ref: topicRef(id),
        label: t.label,
        detail: `${t.depth === 0 ? 'top level' : `level ${t.depth + 1}`} · ${gi.countForTopic[id] ?? 0} books`,
      }));
      for (const [tag, ids] of Object.entries(gi.booksForTag)) {
        const label = tag.replace(/-/g, ' ');
        if (topicLabels.has(label.toLowerCase())) continue;
        out.push({ ref: tagRef(tag), label, detail: `${gi.countForTag[tag] ?? ids.length} books` });
      }
    } else if (gi) {
      out = Object.entries(gi.authorNames).map(([slug, name]) => ({
        ref: authorRef(slug),
        label: name,
        detail: `${gi.booksForAuthor[slug]?.length ?? 0} book${
          (gi.booksForAuthor[slug]?.length ?? 0) === 1 ? '' : 's'
        }`,
      }));
    }

    out.sort((a, b) => sortKey(a.label).localeCompare(sortKey(b.label)));

    // Grouped under initials so a thousand rows can be navigated rather than
    // only scrolled.
    const groups: Array<{ letter: string; items: typeof out }> = [];
    for (const row of out) {
      const letter = initial(row.label);
      const last = groups.at(-1);
      if (last && last.letter === letter) last.items.push(row);
      else groups.push({ letter, items: [row] });
    }
    return groups;
  }, [books, mode]);

  const total = rows.reduce((n, g) => n + g.items.length, 0);

  return (
    <main className="browse">
      <div className="browse__head">
        <h1 className="browse__title">The collection</h1>
        <button type="button" className="panel__link" onClick={onClose}>
          Back to search
        </button>
      </div>

      <div className="browse__modes" role="tablist" aria-label="How to list the collection">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'panel__link panel__link--on' : 'panel__link'}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
        <span className="browse__count">{total}</span>
      </div>

      <nav className="browse__jump" aria-label="Jump to a letter">
        {rows.map((g) => (
          <a key={g.letter} href={`#browse-${g.letter}`}>
            {g.letter}
          </a>
        ))}
      </nav>

      <div className="browse__list">
        {rows.map((group) => (
          <section key={group.letter} aria-labelledby={`browse-${group.letter}`}>
            <h2 className="browse__letter" id={`browse-${group.letter}`}>
              {group.letter}
            </h2>
            <ul>
              {group.items.map((row) => (
                <li key={row.ref}>
                  {/* Every row starts a map. That is the point of the index —
                      it is a way in, not a catalogue to admire. */}
                  <button
                    type="button"
                    className="browse__row"
                    onClick={() => {
                      // Leave the index explicitly. The store navigates with
                      // `pushState`, which does not fire `hashchange`, so the
                      // route would otherwise stay on browse while a map was
                      // built behind it.
                      seed(row.ref);
                      onClose();
                    }}
                  >
                    <span className="browse__label">{row.label}</span>
                    <span className="browse__detail">{row.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
