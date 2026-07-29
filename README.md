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

## Colour, and why there is no dark mode

The field is a **warm greige** (`#F2F0EB`) in every environment. There is
deliberately no `prefers-color-scheme` branch: the whole idea is a light field
of books, and following the system preference handed anyone with a dark desktop
a near-black canvas — the opposite of the thing being built.

Greige rather than pure white is an accessibility decision, not only a stylistic
one. See below.

Colour is spent on the one distinction a reader cannot otherwise recover —
whether a book can still be opened:

| Role | Colour |
|---|---|
| Where you started | `#0b0b0b` ink |
| Can be grown | `#2A7BF6` (macOS blue), bright centre |
| Already grown | `#d16400` (macOS orange, stepped) |
| No further matches | `#898781`, faded |

These hexes are not free to edit. A 3D point field is a scatter, so any two
marks can end up adjacent and the strict **all-pairs** colourblind gate applies.
Running the checks over candidate palettes established that:

- The standard 8-hue categorical palette fails all-pairs (CVD ΔE 3.2).
- The largest passing set is four hues, and those rely on colours near 2.2:1
  against white that vanish as small marks.
- **No three untouched macOS Finder label colours can coexist**: red↔green
  measures ΔE 1.9 under deuteranopia — indistinguishable. macOS labels are chips
  beside text, never marks identified by colour alone.

**What the greige bought.** On pure white, the only orange that stays inside the
CVD lightness band measures 2.57:1 — a RELIEF result, legal only because the app
ships labels and a DOM list. Dropping the surface to `#F2F0EB` left headroom to
step the orange down to `#d16400`, which measures **3.33:1** and clears the 3:1
floor outright. Every mark now passes on its own: blue 3.50:1, orange 3.33:1,
resting points 3.15:1, ink 17.28:1, worst-case CVD ΔE 29.9 against a gate of 8.

The relief channels are still there and still worth keeping — the always-visible
legend, the titles drawn beside their nodes, the DOM outline of the graph — but
the palette no longer depends on them to be legal.

`src/domain/palette.ts` carries the exact validator command. The test does not
merely pin the hexes: it recomputes the contrast ratios, so a nudged colour
fails CI rather than quietly invalidating a comment.

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
data/taxonomy.json        10 top-level branches, 3 levels, 100 leaves
data/tagMap.json          raw subject tag -> taxonomy node(s)
data/unmapped.allow.json  tags with no taxonomy home (see below)
data/legacy-ids.allow.json ids that predate the id rule and are live in URLs
data/corpus/*.json        1016 hand-authored books, one file per branch
```

**Median publication year 2007**, with 60% of the corpus published since 2000.
The first 361 books were a literary/academic canon — median year 1979, and no
vocabulary at all for romance or young adult — so three later passes added ~650
books weighted to modern bestsellers, book-club fiction, romance, thriller, YA
and fantasy, plus Romance and Young Adult branches.

**Two kinds of tag.** A tag in `tagMap.json` names a category the taxonomy has,
and so contributes to both the subject block and the taxonomy-ancestor block. A
tag in `unmapped.allow.json` has no honest taxonomy home. Those still contribute
to similarity through the subject block; they simply do not claim a place in the
hierarchy.

Two things end up there. Settings and themes — `grief`, `friendship`, `london`.
And, less obviously, tags that name a *situation spanning genres*:
`court-politics`, `heist`, `assassins`, `survival`. Forcing those into one
branch makes the ancestor block actively wrong — mapping `court-politics` to
epic fantasy pulled *Wolf Hall* toward *Elantris*. Allowlisted, it still binds
Wolf Hall to *Bring Up the Bodies* through shared subjects, without asserting
that the Tudor court is a fantasy kingdom. Inventing a taxonomy node per theme
would make the tree meaningless; dropping the tags would throw away real signal.

**The corpus is still finite**, and 1016 books is the honest limit on
recommendation quality: some seeds have thin or odd neighbours because there is
genuinely nothing near them. Every description is a real summary of a real book.
None are generated to pad the count — see the fetch script below for the path to
a larger corpus.

**A book's id must name that book.** Ids appear in shared URLs (`#/from/{id}`),
so an id naming a different book makes the link lie about what it opens. A test
enforces it: every part of an id has to come from the book's own title or
authors. Abbreviating is fine (`harry-potter-philosophers-stone`), as is an
author surname for disambiguation (`einstein-isaacson`). Sixteen ids that
predate the rule and are already live sit in `legacy-ids.allow.json`, because
renaming them would break links that exist.

The vocabulary is defined before the corpus on purpose, and a test rejects any
subject tag not in `tagMap.json`. Inconsistent tags (`dystopia` vs `dystopian`)
would quietly degrade the similarity table and nothing else would catch it.

### Adding books

Drop a JSON array into `data/corpus/`. Nothing needs registering — the loader
globs the directory in filename order — then re-bake and run the tests:

```bash
$EDITOR data/corpus/19-whatever.json
npm run neighbors     # rebuilds src/generated/, commit the result
npm test
```

Each entry needs `id`, `title`, `authors`, `year`, at least two `subjects`, and
an 80–600 character `description`. The tests are the specification, and they
name what is wrong rather than just failing:

| If you | you get |
|---|---|
| reuse an id | `has unique ids: ['neuromancer']` |
| give one subject | `another-test (1)` |
| invent a tag | `not-a-real-tag <- another-test` |
| use a tag no other book has | `not-a-real-tag:1` |
| name the id after a different book | `stray: shadow, lost` |
| forget `npm run neighbors` | ``neighbors.json is stale — run `npm run neighbors` `` |

The df≥2 rule is the one that surprises people: a tag on exactly one book cannot
make two books similar, but IDF gives it the highest possible weight, so it
would dominate that book's vector and strand it. Either give the tag a second
book or use an existing one. `data/tagMap.json` and `data/unmapped.allow.json`
list the vocabulary.

### Growing the corpus automatically

```bash
npm run fetch -- --subject science_fiction --subject philosophy --limit 200
npm run corpus:merge
npm run neighbors
npm test
```

**The fetch script has never run against the live service.** `openlibrary.org`
is blocked from the environment this was built in — it answers 403 at the
egress proxy — so no part of it has been exercised end to end.

What that narrows to is one claim: that the endpoint still answers in the shape
recorded in `test/fixtures/openlibrary/`. Everything built on that answer is
tested. Parsing lives in `scripts/lib/openlibraryNormalize.ts`; the request layer
lives in `scripts/lib/openlibraryFetch.ts` and takes its `fetch` as an argument,
so `openlibraryFetch.test.ts` drives it with a stub and checks subject encoding,
the required User-Agent, non-2xx handling, both description shapes the API
returns, attribution stripping, a description failure not aborting the run, and
resume-after-interrupt.

Expect to confirm the response shape on first real run rather than to debug the
request code.
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

## Scaling past this corpus

Two things keep the first screen small, and both matter more as the corpus grows.

**The baked artifacts are fetched, not bundled** — `?url` imports in
`src/state/corpusData.ts`. At 1016 books they are 550KB, and importing them
directly put all of it in the JS bundle to be parsed before anything rendered.
Fetched instead, the code bundle stays flat as the corpus grows, the browser's
JSON parser beats evaluating an equivalent object literal, and a code change no
longer invalidates the cached corpus. Both requests are same-origin; the app
still makes no external calls.

**three.js is in its own chunk.** The app always opens on the landing screen —
one input box, no 3D — yet the renderer sat in the main bundle. Everything that
touches `three` now lives behind `src/ui/MapStage.tsx`, imported dynamically by
`src/ui/lazyMapStage.ts`:

| | main chunk | on demand |
|---|---|---|
| before | 1,150 KB (320 KB gz) | — |
| after | **240 KB (78 KB gz)** | 912 KB (244 KB gz) |

The chunk is preloaded on the first keystroke in the landing input, so it has
usually arrived by the time a book is chosen. A cold deep link with no keystroke
still works — Suspense covers it, and the fallback is an empty stage rather than
a spinner because the panels beside it are already populated and usable.

That boundary is easy to break silently: a single static import of `three` or
`@react-three/*` from the main side puts it all back while everything still
compiles and runs. `lazyMapStage.ts` exists so there is one line to get wrong
rather than two files to keep in agreement.

The taxonomy is a **build-time concern only**. It used to be indexed at startup
— `populateMembers` over every book — and then read by nothing. That is 30KB and
14ms at this size, growing with the corpus, for no runtime purpose. The bake
needs it; the browser does not.

What is known to scale: the neighbour search is a sparse inverted index, and
placement costs depend on the on-screen graph (capped at 220 books), not on
corpus size. What would need attention beyond a few thousand books: the Fuse
search index is built in one synchronous pass at hydration (10ms at 1016), and
descriptions are ~40% of `corpus.json` while only the open book needs one.

## Layout of the code

```
src/domain/    pure logic: taxonomy, search, ISBN, Amazon, palette
src/state/     zustand store, URL hash routing, buffer selectors
src/scene/     three.js / react-three-fiber rendering
src/ui/        React panels and HTML overlays
src/generated/ machine-written, committed: corpus.json + neighbors.json
scripts/lib/    build logic, importable without side effects
scripts/*.ts    thin entry points that call it
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
| `npm run neighbors` | re-bake `src/generated/` (commit the result) |
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
