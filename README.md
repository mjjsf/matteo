# matteo

A book discovery tool. You name one book; it appears alone on a white field in 3D
and immediately branches to the books most similar to it, labelled with their
titles. Hovering shows a description. Clicking any book grows a further
generation from *that* book, and so on — you explore by walking outward, rather
than by filtering a fixed cloud.

```bash
npm install
npm run neighbors   # bake the similar-books table (committed; only needed after editing data/)
npm run dev
```

## How it works

The app opens **empty**, with one centred input. There is nothing useful to show
before we know where someone wants to start, and any pre-populated cloud would be
arbitrary. Typing offers matches; choosing one seeds the graph and expands it once
straight away, because a lone point is not a map.

**Similarity is baked at build time**, not computed in the browser. `npm run
neighbors` reads `data/`, builds a book × feature matrix, and writes each book's
top-16 most similar books to `src/generated/neighbors.json`. A test fails if the
committed table goes stale relative to the data.

The feature matrix is three separately L2-normalised blocks, concatenated with
weights:

| Block | Weight | Notes |
|---|---|---|
| Subjects | 1.0 | IDF per tag — **not** TF-IDF; a tag occurs at most once per book, so there is no term-frequency term |
| Authors | 0.4 | Enough that an author's books sit near each other, not enough to form isolated author pods that outrank subject structure |
| Taxonomy ancestors | 0.55 | Lets two books with no tag in common still score against each other when they sit in the same corner of the tree |

Tags appearing in only one book are pruned. Such a tag cannot make two books
similar, yet IDF gives it the *highest* weight — so it would dominate its book's
vector and make it look uniquely similar to nothing.

Because each block is L2-normalised **before** weighting, a plain dot product
between two rows is already a valid, comparable similarity — no renormalisation.
The top-K search is a **sparse inverted index**, not a dense all-pairs cosine:
rows average ~12 non-zeros, so dense would be N² × D multiply-adds and minutes of
build time at the target corpus size.

Neighbour lists are **variable length**, floored at a similarity of 0.1. Padding
every list to K with weak matches is exactly how a graph fills with nonsense —
two books sharing only a top-level branch score above zero, so without the floor
a sparsely-tagged seed would branch to eight arbitrary books that merely happen
to be Fiction.

### Growing the graph

The seed sits at the origin. When a book is expanded, its children are placed on
a spherical cap around it, on an axis pointing *away* from its own parent so
growth heads outward instead of folding back. Children are distributed by a
golden-angle spiral on an area-uniform cap, and more-similar children sit
slightly closer.

**Already-placed books never move.** Overlap is resolved by a relaxation that
adjusts only the newly added nodes and treats everything already on screen as
fixed. This is the property that keeps expansion from disorienting the reader,
and a test asserts it bit-identically — if anyone "improves" the relaxation into
a global one, that test fails on purpose.

At 220 books the graph **stops and says so**, offering to start a new map from any
book on screen. Losing an exploration someone spent a dozen clicks building, in
order to make room, is worse than telling them the wall exists.

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

So the palette is spent on the one distinction a reader cannot otherwise
recover — whether a book can still be opened:

| Role | Light | Dark |
|---|---|---|
| Where you started | `#0b0b0b` | `#ffffff` |
| Can be grown | `#2A7BF6` (macOS blue), bright centre | `#2A7BF6` |
| Already grown | `#F7821B` (macOS orange) | `#e26f00` |
| No further matches | `#898781`, faded | `#898781` |

Blue and orange measure CVD ΔE 32.0 light / 31.0 dark against gates of 8 and 15.
Light-mode orange sits at 2.57:1 against white, which is permitted only because
the app ships the required relief channel: the always-visible legend, the book
titles drawn beside their nodes, and the DOM outline of the whole graph beside
the map. Those are load-bearing — don't remove them. `src/domain/palette.ts` has
the commands to re-validate, and a test pins the hexes so an edit breaks CI
rather than shipping silently.

## Amazon links, and the absence of Prime

Links are ISBN-based `/dp/` deep links where an ISBN is known, and a
title + author search URL otherwise. Set the affiliate tag with:

```
VITE_AMAZON_ASSOCIATE_TAG=yourtag-20
```

in a `.env.local` (git-ignored, so it is documented here rather than committed).
Without it, links simply carry no tag.

**There is no Prime badge of our own.** Prime eligibility is only obtainable
through Amazon's Product Advertising API, which requires an approved Associates
account and secret-key request signing that cannot happen in a browser.
Displaying "ships with Prime" without verifying it would be inventing facts about
a real product.

What the app does instead is hand Amazon a search URL carrying its **own
Prime-eligible refinement**, and let Amazon's page report what it finds. The link
is labelled by what it *asks for* — "opens an Amazon search filtered to
Prime-eligible results" — never by what a given book ships with.

The refinement id is **unverified from the environment this was built in**:
`amazon.com` is blocked there, so it could not be exercised against the live site,
and it is marketplace-specific (the value in `src/domain/amazon.ts` is for the US
store). It is chosen to fail safe — an unrecognised `rh` refinement makes Amazon
return the ordinary unfiltered results, and since nothing on our side claims
eligibility, a silently ignored refinement cannot become a false claim. Doing it
properly still means PA-API credentials plus a small serverless signing endpoint.

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

**The corpus is small and skews old**: median publication year 1979, only 28% from
2000 onward, and no vocabulary at all for romance or young-adult. It is a
literary/academic canon rather than "what people most read", which is the honest
limit on recommendation quality right now — some seeds have thin or odd
neighbours simply because there is nothing near them. Descriptions are real
summaries of real books, and are not generated to pad the count.

The vocabulary is defined before the corpus on purpose, and a test rejects any
subject tag not in `tagMap.json`. Inconsistent tags (`dystopia` vs `dystopian`)
would quietly degrade the similarity table and nothing else would catch it.

### Growing the corpus

```bash
npm run fetch -- --subject science_fiction --subject philosophy --limit 200
npm run corpus:merge
npm run neighbors
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

The canvas is a visualisation *of* the app, not the app. The graph has a **DOM
mirror**: a depth-ordered list where every book is a real button, with a second
button that grows from it exactly as clicking the node does. Keyboard and screen
reader users walk the identical graph, not a reduced version of it — verified by
growing a map from 9 to 17 books with no mouse.

It is deliberately a plain list rather than `role="tree"`: a tree item may not
contain its own interactive controls, and each row needs two. Depth is announced
as text instead, which every screen reader handles with no custom keyboard model
to learn.

`Escape` unwinds one level per press (notice → selection → the whole map) rather
than clearing everything at once. Under `prefers-reduced-motion` nodes appear at
their final positions instead of easing outward. Without WebGL2 the app falls
back to the same panels at full width, and everything except the map still
works.

## Layout of the code

```
src/domain/    pure logic: taxonomy, search, ISBN, Amazon, palette
src/state/     zustand store, URL hash routing, buffer selectors
src/scene/     three.js / react-three-fiber rendering
src/ui/        React panels and HTML overlays
src/generated/ machine-written, committed: corpus.json + neighbors.json
```

The nodes are one `THREE.Points`, allocated **once** at full capacity and drawn
via `setDrawRange` — the geometry is never rebuilt, because a graph that grows on
every click cannot afford to. Edges are a single `LineSegments` over a
preallocated buffer. Both are driven by `useStore.subscribe` and `useFrame`, so
hovering and growing cause **zero React renders inside the canvas**; routing that
through component state is what makes this kind of scene feel laggy. Picking is a
throttled raycast on a ref rather than R3F's pointer events, which raycast the
whole scene on every native event.

Two subtleties worth keeping. The vertex index **is** the graph slot, never a
corpus index — a branded `Slot` type keeps the two from being confused, since
they coincide only when the scene shows every book in corpus order. And the
bounding sphere is assigned manually on every change: three's `Points.raycast`
computes it only when it is `null`, so a graph growing past a stale sphere would
silently stop being hoverable, with no visual symptom at all.

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
| `npm run neighbors` | re-bake `src/generated/` |
| `npm run fetch` | pull more books from Open Library (unverified — see above) |
| `npm run corpus:merge` | combine authored + fetched |

### Deployment and the base path

The build uses a **relative** base (`./`), so the same artifact works wherever it
is mounted — a Pages project site at `/matteo/`, a user site or custom domain at
`/`, or a preview in a subdirectory. Nothing needs to be configured per
environment.

This matters more than it sounds. With an absolute `/` base, Vite emits
`/assets/index-*.js`, which 404s on a project page: the deploy reports success
and the site serves a blank screen. Relative paths are safe here specifically
because routing is hash-based, so the document's path depth never changes. **If
path-based routing is ever introduced, the base must become an explicit absolute
path again** — `VITE_BASE` still overrides it.

To check a subpath deployment locally:

```bash
npm run build
mkdir -p /tmp/site/matteo && cp -r dist/* /tmp/site/matteo/
(cd /tmp/site && python3 -m http.server 4180)
# open http://localhost:4180/matteo/
```

## Licence

MIT — see [LICENSE.md](LICENSE.md).
