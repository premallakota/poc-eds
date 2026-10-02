# Dynamic Media Image (`dm-image`)

Proof-of-concept block that demos authoring an **AEM Dynamic Media** asset
picked from our AEMaaCS Author instance (via the DA.live "Insert AEM Asset"
toolbar action) and rendering it on the live page as an optimized, responsive
`<picture>` — without any build step or third-party dependency.

## What it demonstrates

- An author drops the asset picker into a normal DA.live table (or inserts
  the block via DA.live's block library — see below), no manual URL
  copy/paste.
- The block resolves either shape DA.live can produce for an inserted asset:
  - a plain `<img>` already pointing at a resolved rendition, or
  - a plain `<a>` whose href is the raw Dynamic Media / AEM Assets delivery
    URL (when `aem.assets.image.type=link` is configured).
- At render time the block requests several width-specific renditions from
  the asset delivery host via query params (`width`, `format=webply`,
  `optimize=medium` on every variant, including the fallback `<img>`) and
  assembles a `srcset`/`sizes` responsive image.
- An optional trailing row lets an author add a caption (also used as the
  `alt` text fallback when the picker/link text doesn't carry one).
- The block searches the whole block for the image/link rather than
  assuming a fixed row position, so it's resilient to content inserted via
  DA.live's block library, which can carry an extra leading text row (see
  "Known quirks" below).

This block cannot publish or activate an asset, and it doesn't check whether
a given URL will actually resolve. The selected asset must already be
**approved** and **published/replicated** to the delivery tier, and that
delivery tier itself (Dynamic Media with OpenAPI) must be provisioned on the
AEM program. Until all of that is true, a delivery URL such as
`https://delivery-p56807-e1482157.adobeaemcloud.com/...` may correctly
return 404 even though the block markup and URL transformation are working
exactly as intended — see "Known limitations" below.

## DA.live prerequisite configuration

This block is self-contained (see "Self-contained by design" below), but the
**asset picker itself** only appears in the DA.live toolbar once the AEM
Assets integration is configured for the site in DA.live's `da.live/config`
(`da.live/config#/kprasad05/aig-eds-migration-poc/`, `data` sheet). Set:

| Key | Value for this POC | Purpose |
| --- | --- | --- |
| `aem.repositoryId` | `author-p<program>-e<env>.adobeaemcloud.com` | Controls which host the picker **browses/searches** (folder navigation, search results, thumbnails). This should be an `author-...` host so browsing works against Author. |
| `aem.asset.dm.delivery` | `on` | Browse via Author (per `aem.repositoryId`), but **construct the actual inserted link** against the separate `delivery-...` host for the same program+environment. Author is auth-gated and isn't meant to serve binaries to anonymous site visitors, so the two hosts do two different jobs — this key is what makes DA.live build the public-facing URL at insert time. |
| `aem.asset.smartcrop.select` | `on` (optional) | Shows the Smart Crop selection dialog when an image is selected in the picker. Implies DM delivery. |
| `aem.assets.image.type` | `link` | Makes DA.live insert a plain `<a href="...">` to the asset delivery URL instead of an `<img>`, which is the path this block's link-detection branch demos. Leave unset (or `img`) to test the `<img>`-based branch instead. |

Full setup instructions: https://docs.da.live/administrators/guides/setup-aem-assets

`aem.repositoryId` and `aem.asset.dm.delivery` are not interchangeable and
both matter — changing one does not substitute for the other. If you need to
point this POC at a different AEM environment, update `aem.repositoryId`
(and re-verify `aem.asset.dm.delivery`/`aem.assets.image.type` still make
sense for that environment).

## Getting an asset approved

DA.live's picker (branded "Content Advisor" in the UI) hard-filters results
to `Asset Status: Approved` — this is a read-only filter that cannot be
removed from the picker itself. A freshly uploaded asset will not appear in
the picker at all until it clears this gate. The correct, standard way to
approve an asset:

1. In the AEM Assets UI, select the asset's parent folder (or the asset
   itself).
2. Click **Create Review Task** in the toolbar.
3. Assign the task (to yourself, for a POC/self-review) and submit.
4. Open the task from the AEM **Inbox** and complete/approve it.

This flips the asset's `Review Status` to `Approved` via AEM's standard
Review feature. On some environments this toolbar action isn't available or
no review workflow is configured at all — in that case the only path found
was an admin manually exposing the `Review Status` field via the asset's
**Metadata Schema** (clearing "Disable edit" on that field) and setting it
directly on the asset's Properties. That's a workaround, not the intended
path — prefer `Create Review Task` if it's available.

Approval alone does not make an asset servable — see the next section.

## Block library setup (Insert Block picker)

Beyond hand-authoring a table, DA.live has its own native block-library
picker ("Insert Block"). That list is driven by a `library/blocks` content
sheet (`name`/`path` pairs) plus one example document per block under
`library/blocks/<name>` — it is **not** auto-derived from what's in the git
branch, and merging code to `main` has no effect on it. To make
`Dynamic Media Image` selectable from that picker:

1. Create an example document at `library/blocks/dm-image` with the same
   table shape as the "Sample authored table" below.
2. Add a row to the `library/blocks` sheet: `name` = `Dynamic Media Image`,
   `path` = `https://content.da.live/kprasad05/aig-eds-migration-poc/library/blocks/dm-image`.

## Self-contained by design

This repo does not currently have any AEM Assets plugin wiring in
`scripts/scripts.js` (no `aem-assets-plugin-support.js`, no documented
`externalImageUrlPrefixes` allowlist for keeping external DM URLs instead of
rewriting them to `/media_*`). Rather than assume that infrastructure exists,
`dm-image.js` does its own detection and rendition-URL building, so it works
whether or not such a plugin is ever added later.

## Authoring: building the block table in DA.live

1. In a DA.live document, insert a table (or use "Insert Block" once the
   library entry above exists).
2. First cell of the first row: block name, `Dynamic Media Image` (maps to
   the `dm-image` block name).
3. Next row, single cell: place the cursor in the cell and use the
   **Insert AEM Asset** icon in the rich text toolbar to pick the Dynamic
   Media asset. DA.live inserts either the resolved `<img>` or the asset
   link, depending on `aem.assets.image.type`.
4. Optional trailing row, single cell: type a caption. If present, it is
   rendered under the image and used as the `alt` text fallback when the
   picker didn't set one.

The block scans the whole block element for an `<img>` or `<a>` rather than
assuming a fixed row index. For the `<img>` case, any image found is used
regardless of host. For the `<a>` case, the href must match an
`author-p###-e###.adobeaemcloud.com` or `delivery-p###-e###.adobeaemcloud.com`
host or it's ignored. If neither is found, the block logs a `[dm-image]`
console warning and leaves the original authored content untouched — no
destructive changes.

### Known quirks

Content inserted via DA.live's block library can carry an extra leading text
row that repeats the block's display name (`Dynamic Media Image`) ahead of
the actual image/link row — this is a quirk of how the library example doc
gets copied in, not something to type manually. The block handles this
correctly (see `drafts/dm-image-test.html`'s fourth test case), but if you're
debugging unexpected block output, check whether an extra text-only row
exists ahead of the image row before assuming the block itself is broken.

### Sample authored table

| Dynamic Media Image |
| --- |
| ![Product Hero Shot](https://delivery-p56807-e1482157.adobeaemcloud.com/adobe/assets/urn:aaid:aem:1234-5678-90ab-cdef/as/product-hero-shot.jpg) |
| Product hero shot, Q3 campaign |

Rendered as `.plain.html`, that table becomes:

```html
<div class="dm-image">
  <div>
    <div>
      <img src="https://delivery-p56807-e1482157.adobeaemcloud.com/adobe/assets/urn:aaid:aem:1234-5678-90ab-cdef/as/product-hero-shot.jpg" alt="Product Hero Shot">
    </div>
  </div>
  <div>
    <div>Product hero shot, Q3 campaign</div>
  </div>
</div>
```

If `aem.assets.image.type=link` is set, the picker instead inserts an anchor:

```html
<div class="dm-image">
  <div>
    <div>
      <a href="https://delivery-p56807-e1482157.adobeaemcloud.com/adobe/assets/urn:aaid:aem:1234-5678-90ab-cdef/as/product-hero-shot.jpg">product-hero-shot.jpg</a>
    </div>
  </div>
  <div>
    <div>Product hero shot, Q3 campaign</div>
  </div>
</div>
```

Both shapes decorate to the same responsive `<picture>` + caption markup:

```html
<div class="dm-image">
  <picture>
    <source srcset="...&width=320&format=webply&optimize=medium 320w, ... 480w, ... 768w, ... 1024w, ... 1600w, ... 2000w" sizes="100vw">
    <img src="...&width=1024&format=webply&optimize=medium" alt="Product Hero Shot" loading="lazy">
  </picture>
  <p class="dm-image-caption">Product hero shot, Q3 campaign</p>
</div>
```

## Known limitations

Three independent gates sit between "author picks an asset" and "a real
photo renders on the live page," and all three must be satisfied:

1. **Approval** — the asset's `Review Status` must be `Approved` (see
   "Getting an asset approved").
2. **Publish/replication** — the asset must be published (e.g. Quick
   Publish) so it's actually replicated to the delivery tier, not just
   approved in Author.
3. **Dynamic Media with OpenAPI provisioning** — the AEM program itself must
   have the Dynamic Media delivery microservice (the `delivery-...` host)
   provisioned. This is easy to conflate with Dynamic Media *processing*
   (Image Profiles, Smart Crop, encoding presets), which is a folder-level
   feature that can work perfectly well on its own. A `delivery-...` URL
   404ing after both (1) and (2) are done is a strong signal that (3) isn't
   provisioned on that program — that's an AEM Cloud Manager / licensing
   question, not something fixable from DA.live, the Assets UI, or this
   block's code.

## Testing locally

1. `npm install` (once, if not already done).
2. Start the AEM CLI dev server against this branch's preview content:
   `npx -y @adobe/aem-cli up --no-open --forward-browser-logs`
   (serves `http://localhost:3000`, proxying content from
   `https://main--aig-eds-migration-poc--kprasad05.aem.page/` or the current
   branch's preview, whichever the CLI resolves to).
3. Without a real authored page yet, use `drafts/dm-image-test.html`
   (covers the `<img>` case, the `<a>` link case, the empty/unauthored case,
   and the block-library extra-row case) with
   `--html-folder drafts`, opening `http://localhost:3000/drafts/dm-image-test`.
4. Confirm in devtools:
   - The block renders a `<picture>` with one `<source srcset>` listing
     multiple width-tagged URLs, plus a fallback `<img>`.
   - Every URL (srcset entries and the fallback `src`) carries `width`,
     `format=webply`, and `optimize=medium` query params.
   - If no asset was authored (empty block), the console logs a
     `[dm-image]` warning and nothing else breaks on the page.
5. Once DA.live's AEM Assets integration is configured and an asset has
   cleared all three gates in "Known limitations" above, verify the
   selected asset's raw delivery URL returns HTTP 200 before testing the
   block on a real authored page. Then use the asset picker instead of
   hand-typed markup.
