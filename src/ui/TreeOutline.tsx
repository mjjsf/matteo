import { useStore } from '@/state/store';

/** The search-derived tag tree as a nested list.
 *
 *  Mirrors the 3D tree one-to-one. This is genuinely the fastest way to navigate
 *  three levels, and it is what makes the tree reachable by keyboard and screen
 *  reader — the 3D version is the same data, flown through. */
export function TreeOutline(): React.ReactElement | null {
  const searchTree = useStore((s) => s.searchTree);
  const activeBranchId = useStore((s) => s.activeBranchId);
  const setActiveBranch = useStore((s) => s.setActiveBranch);

  if (searchTree.length === 0) return null;

  const childrenOf = (parentId: string | null): typeof searchTree =>
    searchTree.filter((n) => n.parentId === parentId);

  const render = (parentId: string | null): React.ReactElement | null => {
    const nodes = childrenOf(parentId);
    if (nodes.length === 0) return null;
    return (
      <ul className="tree">
        {nodes.map((node) => {
          const isActive = activeBranchId === node.id;
          return (
            <li key={node.id}>
              <button
                type="button"
                className={isActive ? 'tree__node tree__node--active' : 'tree__node'}
                aria-pressed={isActive}
                onClick={() => setActiveBranch(isActive ? null : node.id, { fly: true })}
              >
                <span className="tree__label">{node.label}</span>
                <span className="tree__count">{node.matchCount}</span>
              </button>
              {render(node.id)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <nav className="tree-wrap" aria-label="Subject tree for these results">
      <h2 className="panel__heading">
        Tags in these results
        {activeBranchId && (
          <button
            type="button"
            className="link-button"
            onClick={() => setActiveBranch(null)}
          >
            clear filter
          </button>
        )}
      </h2>
      {render(null)}
    </nav>
  );
}
