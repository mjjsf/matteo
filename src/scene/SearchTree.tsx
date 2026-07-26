import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useStore } from '@/state/store';
import type { ThemeColors } from '@/domain/palette';
import { useTreeLayout } from './useTreeLayout';

/** The tag tree's 3D geometry: spheres and edges.
 *
 *  Labels are deliberately NOT rendered here. drei's <Text> uses troika, which
 *  fetches font-resolver data from a CDN at runtime — an external network
 *  request this app must not make (it has to work offline, and a strict CSP
 *  would block it anyway). Labels are HTML instead, in `ui/TreeLabels.tsx`:
 *  no network, crisper text, real CSS, and zero extra draw calls. */
export function SearchTree({
  radius,
  theme,
}: {
  radius: number;
  theme: ThemeColors;
}): React.ReactElement | null {
  const placed = useTreeLayout();
  const activeBranchId = useStore((s) => s.activeBranchId);
  const setActiveBranch = useStore((s) => s.setActiveBranch);

  const nodeById = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  if (placed.length === 0) return null;

  return (
    <group>
      {placed.map((node) => {
        const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
        const isActive = activeBranchId === node.id;
        const dimmed = activeBranchId !== null && !isActive;

        return (
          <group key={node.id}>
            {/* Parent -> child edge, visibly descending. */}
            {parent && (
              <Line
                points={[parent.position, node.position]}
                color={theme.treeNode}
                lineWidth={1}
                transparent
                opacity={dimmed ? 0.12 : 0.4}
              />
            )}

            {/* Tether down to the centroid of the books this node describes,
                which is what makes the anchoring legible. */}
            <Line
              points={[node.position, node.anchor]}
              color={theme.treeNode}
              lineWidth={1}
              dashed
              dashSize={radius * 0.012}
              gapSize={radius * 0.012}
              transparent
              opacity={dimmed ? 0.06 : 0.22}
            />

            <mesh
              position={node.position}
              onClick={(e) => {
                e.stopPropagation();
                setActiveBranch(isActive ? null : node.id, { fly: !isActive });
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = '';
              }}
            >
              <sphereGeometry args={[node.size, 20, 20]} />
              <meshBasicMaterial
                color={isActive ? theme.sameSubject : theme.treeNode}
                transparent
                opacity={dimmed ? 0.2 : 0.8}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
