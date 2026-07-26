import { createHash } from 'node:crypto';

/** Stable JSON stringify: object keys sorted at every level, so an irrelevant
 *  key reordering in an authored file does not invalidate the layout. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

/** Hash of everything the baked layout depends on. Compared by a test so a
 *  stale `layout.json` fails CI rather than shipping coordinates that no longer
 *  match the corpus. */
export function inputHash(parts: {
  corpus: unknown;
  taxonomy: unknown;
  tagMap: unknown;
  config: unknown;
}): string {
  return createHash('sha256').update(stable(parts)).digest('hex');
}
