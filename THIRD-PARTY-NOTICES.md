# Third-party notices

This project is proprietary (see `LICENSE.md`), but it is built on software
owned by others and distributed under permissive open-source licences. Those
licences permit that use; they also require that their copyright notices travel
with any distribution of the resulting work.

This file exists to satisfy that requirement, and it applies to the deployed
site as well as to the source: every package listed here ships inside the
JavaScript bundle a visitor downloads.

Asserting rights over this project while relying on grants from other people
makes honouring these terms more important, not less.

---

## MIT-licensed components

The following are used under the MIT Licence. Its full text is reproduced once
below, since it is identical for each.

| Package | Copyright |
|---|---|
| `react` | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-dom` | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `three` | Copyright © 2010-2026 three.js authors |
| `zustand` | Copyright (c) 2019 Paul Henschel |
| `@react-three/fiber` | Copyright (c) 2019 Paul Henschel |
| `@react-three/drei` | Copyright (c) 2020 react-spring |

> MIT License
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

---

## Apache-2.0 licensed components

### `fuse.js`

Copyright 2017 Kirollos Risk

Licensed under the Apache Licence, Version 2.0. You may obtain a copy at
<http://www.apache.org/licenses/LICENSE-2.0>. The full text is included in the
package at `node_modules/fuse.js/LICENSE`.

Unless required by applicable law or agreed to in writing, software distributed
under the Licence is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the Licence for the
specific language governing permissions and limitations under it.

Two clauses of Apache-2.0 that MIT does not have, and how they are met here:

- **§4(b), stating modifications.** `fuse.js` is used unmodified, as published.
- **§4(d), propagating a `NOTICE` file.** The distributed package contains no
  `NOTICE` file, so there is nothing to propagate. Checked rather than assumed;
  if a future version adds one, its contents belong here.

---

## Build-time dependencies

TypeScript, Vite, Vitest, happy-dom, Testing Library and the type packages are
used to build and test this project but are not redistributed as part of it, so
their notices are not required here. They remain under their own licences.

---

## Keeping this accurate

This list is generated from what is actually installed, not from memory. When a
runtime dependency is added, removed or changes its licence, update this file in
the same commit — an omission here is a licence violation, not a documentation
gap.

To re-derive the list:

```bash
node -e "const p=require('./package.json');for(const d of Object.keys(p.dependencies))\
console.log(d, require('./node_modules/'+d+'/package.json').license)"
```
