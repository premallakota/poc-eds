# Site Search

Ported from the sibling `aig-aem-eds-poc` project (see that repo's
`docs/search.md`), adapted for the two ways this project's platform
actually differs — full-text body search works here, and there's no
component-model registration step. Both are explained below.

## How it works

Two independent sources, merged into one ranked list on the results page:

- **Pages** — [scripts/search.js](../scripts/search.js) fetches
  [`/query-index.json`](https://www.aem.live/developer/indexing) (the
  site's auto-generated page index, configured in
  [helix-query.yaml](../helix-query.yaml)) and scores/ranks entries
  client-side: matches in `title` count most, then `description`, then
  `bodyText`, then `path`. No external search library — the matching
  logic is ~15 lines of substring scoring.
- **DAM documents** (PDF/Word/PowerPoint/Excel) —
  [scripts/document-search.js](../scripts/document-search.js) calls a
  small Vercel serverless proxy that this project doesn't own — see
  "Document search backend" below.

Two pieces of UI:

- **Header search** ([blocks/header/header.js](../blocks/header/header.js)) —
  clicking `.nav-search-btn` opens an inline field (replacing the
  nav-sections row), built the same way the rest of this header builds
  controls that have no DA-authored source (per the "built in JS per
  DA-flat contract" convention already used for this button). This is
  quick search (pages only, top 10, typeahead) — it does not call
  document search; that's intentionally scoped to the full results page
  below. It shares `scripts/search.js`'s cached `fetchIndex()` with the
  nav's own dynamic-link/hidenav logic, so opening the header search
  doesn't trigger a second `/query-index.json` fetch.
- **`search-results` block**
  ([blocks/search-results/search-results.js](../blocks/search-results/search-results.js)) —
  reads `?q=` from the URL, runs both searches in parallel
  (`Promise.allSettled`, so one source failing doesn't hide the other's
  results), normalizes each source's relevance score to a 0-1 scale
  *relative to its own best match* (the two sources' raw scores are on
  incomparable scales — see `normalizeRank`), and merges into one ranked
  list. A "Refine Result" facet panel filters by format
  (`html`/`pdf`/`document`/`ppt`/`excel`) entirely client-side, from
  results already in memory. Facet state lives in the URL
  (`?format=pdf,document`), same as the query (`?q=`).

## Full-text body search — this works here

The sibling project's `docs/search.md` documents that a body-scoped
`helix-query.yaml` property never showed up in `query-index.json`, no
matter the property name or extraction function, and concluded that was a
platform-level limit of AEM-as-content-source — not something fixable
from `helix-query.yaml` alone.

That limit is specific to indexing content sourced from AEM Sites. This
project is plain git/DA-authored EDS, the case aem.live's own indexing
docs describe as supporting body selectors — and this repo already had
living proof before this feature existed: `helix-query.yaml`'s
`video-index` target selects `main .video-feature a` /
`main .video-feature img`, both body-scoped, and those columns do appear
in `video-index.json`.

So `query-index` here gets a real `bodyText` property:

```yaml
bodyText:
  select: main
  value: words(textContent(el), 0, 300)
```

This is the exact selector/function pair the sibling repo's doc lists as
attempt #1 of three failed attempts there. The helix indexer's expression
evaluator resolves function calls innermost-first (confirmed by reading
`@adobe/helix-shared-indexer`'s source), so `words(textContent(el), 0,
300)` is valid: `textContent(el)` turns the selected `<main>` element into
its text, and `words()` then slices the first 300 words of that text. The
syntax was never the problem on the sibling project; the AEM-as-content-source
indexer just never evaluated body-scoped selectors at all.

`scripts/search.js`'s `scoreEntry` includes `bodyText` in scoring, weighted
between `description` and `path` — a match anywhere in a page's first 300
words of body copy now surfaces it, not just a match in authored
Title/Description metadata.

**Verifying it:** `/query-index.json` on `localhost:3000` is proxied from
the live preview branch, not recomputed from your local working copy —
so editing `helix-query.yaml` locally won't add `bodyText` to what you see
at `localhost:3000/query-index.json` until it's pushed. After pushing:

- Republishing a page picks up new values for *already-established*
  columns, but does **not** add a brand-new column like `bodyText` to
  already-published pages.
- A full reindex does add it:

  ```bash
  curl -X POST "https://admin.hlx.page/index/<owner>/<repo>/<branch>/*" \
    -H "authorization: token $API_KEY"
  ```

  Then confirm via `curl https://<branch>--<repo>--<owner>.aem.page/query-index.json`
  and check `columns` includes `bodyText`.

## Document search backend

Unlike page search, document search needs a real backend — an AEM DAM
search servlet that requires HTTP Basic Auth credentials that must never
reach the browser. The sibling `aig-aem-eds-poc` project already solved
this with a small Vercel serverless proxy
([api/search.js](https://github.com/TyroneAEM/aig-aem-eds-poc/blob/main/api/search.js) in that
repo), deployed at `https://aig-aem-eds-poc.vercel.app/api/search`, that
holds the credentials server-side and forwards a fixed allow-list of query
params.

This project reuses that same deployed endpoint directly from
`scripts/document-search.js` — it talks to the same AIG DAM instance, so
there's no reason to stand up a second Vercel project with duplicate
credentials for a POC. If this project ever needs its own document-search
backend (different AEM credentials/instance), point
`DOCUMENT_SEARCH_URL` in `scripts/document-search.js` at the new proxy;
`normalize()` is the only place that would need to change for a different
response shape.

**Note:** the shared servlet indexes DAM asset types beyond the
documented `pdf`/`document`/`ppt`/`excel` scope (e.g. plain images) —
`searchDocuments()` filters those out before they reach the UI, since
this project's facets/badges only know about the four documented formats.

Document result links point at the DAM's raw repository path (e.g.
`/content/dam/aig/pdfs/foo.pdf`), which this project has no publish route
for — same known limitation as the sibling project. Follow that project's
doc for what changes once a real Asset Publish tier exists.

## No component/model registration step

The sibling project is AEM Sites content-sourced and uses Universal
Editor's content-model system: a new block needs an entry in a
`models/_section.json`-style component allow-list plus its own
`_search-results.json` model before an author can place it.

This project has none of that — no `fstab.yaml`, no `models/` folder, no
per-block `_blockname.json`, no `eslint-plugin-xwalk` — because DA-authored
content doesn't go through Universal Editor's component-model system at
all. Placing a new block here needs nothing beyond the block folder
itself: EDS decorates any `main > .section > div` whose first class
matches a folder under `/blocks/` (see `decorateBlocks`/`loadBlock` in
`scripts/aem.js`), so once
[blocks/search-results/search-results.js](../blocks/search-results/search-results.js)
and its CSS exist, an author places the block by authoring a table named
"Search Results" in a DA document — no registration step, no allow-list
entry, nothing else to wire up.

The search-results page itself is just a normal DA-authored page at
`/search-results` containing that one block; the header's search form
(`action="/search-results"`, `?q=` as the query param) and the Enter-key
fallback both target that path.

## Known scope limits

- **Facet counts are capped at what one document-search call returns** —
  the servlet's own maximum (`limit=50`), since its response has no true
  `total`. Fine for this POC's data volume.
- **Document result links 404** until a real Asset Publish tier is
  provisioned (see "Document search backend" above).
- **Page-type facets don't exist** (only format facets) — would need new
  authored metadata rolled out across pages to add.
