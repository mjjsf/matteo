# matteo

A searchable book discovery tool. Books are points on a white field in 3D,
positioned so that shared subjects and authors become visible spatial structure.
Searching grows a navigable tree of tags in the same space; hovering a point
lights up its relatives; clicking one opens a description and an Amazon link.

```bash
npm install
npm run layout   # bake the 3D coordinates (committed already; only needed after editing data/)
npm run dev
```

## How it works

**Positions are baked at build time**, not computed in the browser. `npm run
layout` reads `data/`, builds a book × feature matrix, reduces it to 3D, and
writes `src/generated/layout.json`. The app just loads coordinates, so first
paint is instant and every viewer sees an identical layout. A test fails if the
committed layout goes stale relative to the data.

The feature matrix is three separately L2-normalised blocks, concatenated with
weights:

| Block | Weight | Notes |
|---|---|---|
| Subjects | 1.0 | IDF per tag — **not** TF-IDF; a tag occurs at most once per book, so there is no term-frequency term |
| Authors | 0.4 | Enough that an author's books sit near each other, not enough to form isolated author pods that outrank subject structure |
| Taxonomy ancestors | 0.55 | Makes the layout partly agree with the tag tree, which is what makes the tree's positions meaningful |

Tags appearing in only one book are pruned. Such a tag cannot make two books
similar, yet IDF gives it the *highest* weight — so it would dominate its book's
vector and fling it to the edge.

Then: PCA to 30 dimensions → UMAP seeded from the PCA result → a gentle pull
toward each book's top-level branch → separation of coincident points → scale to
a fixed radius. `LAYOUT_CONFIG.strategy` switches between `pca3`, `umap`, and
`hybrid` (the default) so they can be compared.

**Why hybrid.** Pure PCA is honest but flat. Pure UMAP looks crisper but its
global arrangement is seed noise — with sparse tags, hundreds of book pairs share
no tags at all, so their distances tie and the tie-breaking decides the shape.
That produces convincing-looking clusters that mean nothing, which is worse than
a boring layout. Seeding UMAP from PCA keeps local neighbourhoods while making
the global shape reproducible.

Run `npx vite-node scripts/compare-layouts.ts` to measure the alternatives. It
reports neighbourhood purity (of each book's 10 nearest neighbours, how many
share its branch) against a random baseline of ~13.5%, plus spread metrics that
catch over-collapse.

**The attraction strength compounds.** Total pull is
`1 - (1 - gamma)^iterations`, not `gamma`. At `gamma 0.12` over 40 iterations
that is a 99.4% pull, which collapses each branch to a single point and yields a
meaningless 100% purity. The default `0.015` gives ~81% purity while branches
keep about half the cloud's spread. The table in `src/layout/config.ts` records
the measurements.

## Colour

Colour appears **on rollover only** — nothing is colour-coded at rest. That is a
consequence of measurement, not taste. A 3D point cloud is a scatter, so any two
marks can end up adjacent and the strict all-pairs colourblind-safety gate
applies. Running the checks over candidate palettes established that:

- The standard 8-hue categorical palette fails all-pairs (CVD ΔE 3.2).
- The largest set passing in both light and dark is four hues, and those rely on
  colours near 2.2:1 against white that vanish as small marks.
- **No three untouched macOS Finder label colours can coexist**: red↔green
  measures ΔE 1.9 under deuteranopia — indistinguishable. macOS labels are chips
  beside text, never marks identified by colour alone.

So the palette is spent on the handful of points related to whatever is under the
cursor:

| Role | Light | Dark |
|---|---|---|
| Hovered / selected | `#0b0b0b` | `#ffffff` |
| Same author | `#2A7BF6` (macOS blue) | `#2A7BF6` |
| Same subject | `#F7821B` (macOS orange) | `#e26f00` |
| Shares a tag | *no hue* — larger point + ring | same |
| At rest | `#898781` | `#898781` |

Blue and orange measure CVD ΔE 32.0 light / 31.0 dark against gates of 8 and 15.
Light-mode orange sits at 2.57:1 against white, which is permitted only because
the app ships the required relief channel: the DOM result list and an
always-visible label on the hovered point. Those are load-bearing — don't remove
them. `src/domain/palette.ts` has the commands to re-validate, and a test pins
the hexes so an edit breaks CI rather than shipping silently.

There is deliberately no third relation hue, because no safe third macOS hue
exists. Relation colour also survives dimming during a search, so hovering a
result reveals relatives the query filtered out — that is the discovery the tool
is for.

## Amazon links, and the absence of Prime

Links are ISBN-based `/dp/` deep links where an ISBN is known, and a
title + author search URL otherwise. Set the affiliate tag with:

```
VITE_AMAZON_ASSOCIATE_TAG=yourtag-20
```

in a `.env.local` (git-ignored, so it is documented here rather than committed).
Without it, links simply carry no tag.

**There is no Prime badge, and no shipping claim.** Prime eligibility is only
obtainable through Amazon's Product Advertising API, which requires an approved
Associates account and secret-key request signing that cannot happen in a
browser. Displaying "ships with Prime" without verifying it would be inventing
facts about a real product, so the UI says nothing about shipping and lets
Amazon's own page report it. Adding it for real means PA-API credentials plus a
small serverless signing endpoint.

The seed corpus also carries **no fabricated ISBNs**. A checksum-valid but
incorrect ISBN would deep-link to the wrong book, which is worse than no link, so
books without a known ISBN fall back to search and are labelled "Find on Amazon"
rather than "Buy on Amazon". `npm run fetch` populates real ISBNs from Open
Library.

## Data

```
data/taxonomy.json     8 top-level branches, 3 levels, 122 nodes
data/tagMap.json       raw subject tag -> taxonomy node(s)
data/corpus/*.json     361 hand-authored books, one file per branch
```

The vocabulary is defined before the corpus on purpose, and a test rejects any
subject tag not in `tagMap.json`. Inconsistent tags (`dystopia` vs `dystopian`)
would quietly degrade the layout and nothing else would catch it.

### Growing the corpus

```bash
npm run fetch -- --subject science_fiction --subject philosophy --limit 200
npm run corpus:merge
npm run layout
npm test
```

**The fetch script's HTTP path is unverified.** It was written in an environment
where `openlibrary.org` is blocked by network policy, so it has never been run
end to end. The *parsing* is well covered — every transform lives in
`scripts/lib/openlibraryNormalize.ts` and is tested against committed samples of
the real API shape — but expect to adjust the request layer on first real run.
It writes only to `data/corpus.fetched.json` and never touches the authored
files, and the merge lets the authored corpus win every conflict, so a bad run
cannot destroy hand-written work.

## Accessibility

The canvas is a visualisation *of* the app, not the app. Every function is
reachable through real DOM: a labelled search input, results as a focusable list,
the tag tree as a nested list, and a live-region detail panel. The list drives
the scene, so keyboard and pointer users take the same code path. `Escape`
unwinds one level per press (selection → branch filter → query) rather than
clearing everything at once. Without WebGL2 the app falls back to the same
panels at full width.

## Layout of the code

```
src/domain/    pure logic: taxonomy, search, ISBN, Amazon, palette
src/layout/    the embedding pipeline (build-time only, never bundled)
src/state/     zustand store, URL hash routing, buffer selectors
src/scene/     three.js / react-three-fiber rendering
src/ui/        React panels and HTML overlays
src/generated/ machine-written, committed: corpus.json + layout.json
```

The point cloud is one `THREE.Points` with a custom shader — a single draw call,
with hover and filter state delivered through two mutable buffer attributes.
Hovering causes zero React renders inside the canvas; routing it through
component state is what makes this kind of scene feel laggy. Picking is a
throttled raycast on a ref rather than R3F's pointer events, which raycast the
whole scene on every native event.

Labels are HTML overlays rather than 3D text. drei's `<Text>` fetches font data
from a CDN at runtime, which this app must not do — it has to work with no
network access at all.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | typecheck + production build |
| `npm test` | vitest (pure logic in node, panels in happy-dom) |
| `npm run typecheck` | tsc only |
| `npm run layout` | re-bake `src/generated/` |
| `npm run fetch` | pull more books from Open Library (unverified — see above) |
| `npm run corpus:merge` | combine authored + fetched |

Reproduce the GitHub Pages subpath build locally with
`VITE_BASE=/matteo/ npm run build && npm run preview`.

## Licence

MIT — see [LICENSE.md](LICENSE.md).
