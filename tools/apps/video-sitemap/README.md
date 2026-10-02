# Video Sitemap Generator App

An Adobe App Builder (DA) application that generates a **Google Video Sitemap XML** on-demand from the project's `/video-index.json` and publishes it directly to `/video-sitemap.xml` on the live site — **no repo commit or local Node.js environment required**.

## How It Works

1. The app fetches `<host>/video-index.json` at runtime from the configured EDS live host.
2. It filters rows that contain a `videourl` column (same logic as `tools/generate-video-sitemap.js`).
3. It builds a valid `video-sitemap.xml` string in memory using the Google Video Sitemap schema.
4. The result is displayed in a scrollable code preview inside the DA iframe.
5. The user clicks **"Publish to /video-sitemap.xml"**, which runs three steps automatically:
   - **Write to DA source** — `PUT https://admin.da.live/source/{org}/{site}/video-sitemap.xml`
   - **Trigger preview** — `POST https://admin.hlx.page/preview/{org}/{site}/main/video-sitemap.xml`
   - **Publish to live** — `POST https://admin.hlx.page/live/{org}/{site}/main/video-sitemap.xml`
6. The sitemap is now live at `<host>/video-sitemap.xml`.

Alternatively, use **Copy XML** or **Download** to get the raw XML without publishing.

## XML Schema

The generated file follows the [Google Video Sitemap schema](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps):

```xml
<?xml version="1.0"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="https://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://main--repo--org.aem.live/path/to/page</loc>
    <video:video>
      <video:title>…</video:title>
      <video:description>…</video:description>
      <!-- YouTube/Vimeo → player_loc; direct .mp4 → content_loc -->
      <video:player_loc allow_embed="yes">https://www.youtube.com/watch?v=…</video:player_loc>
      <video:thumbnail_loc>https://…/image.png</video:thumbnail_loc>
    </video:video>
  </url>
</urlset>
```

`videourl` values that match `youtube.com`, `youtu.be`, or `vimeo.com` are emitted as `<video:player_loc>`. All other URLs (direct `.mp4` links) are emitted as `<video:content_loc>`.

## video-index.json Columns

The app reads these columns from `/video-index.json`:

| Column          | Used for                                    |
|-----------------|---------------------------------------------|
| `path`          | Page path → `<loc>` URL                     |
| `title`         | `<video:title>`                             |
| `description`   | `<video:description>`                       |
| `videourl`      | `<video:player_loc>` or `<video:content_loc>` |
| `videothumbnail`| `<video:thumbnail_loc>` (highest priority)  |
| `image`         | `<video:thumbnail_loc>` (fallback)          |
| `thumbnail`     | `<video:thumbnail_loc>` (legacy fallback)   |

Only rows with a non-empty `videourl` are included.

## URL Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `host`    | No       | Override the EDS live host (e.g. `https://main--myrepo--myorg.aem.live`). If omitted the app derives the host from the DA context (`org`/`repo`). |

**Example DA App URL:**
```
https://da.live/app/kprasad05/aig-eds-migration-poc/tools/apps/video-sitemap/video-sitemap
```

**With explicit host override:**
```
https://da.live/app/kprasad05/aig-eds-migration-poc/tools/apps/video-sitemap/video-sitemap?host=https://main--aig-eds-migration-poc--kprasad05.aem.live
```

## Publish Flow (detailed)

```
App
 │
 ├─1─ GET  <host>/video-index.json          → filter videourl rows → build XML in memory
 │
 ├─2─ PUT  admin.da.live/source/{org}/{site}/video-sitemap.xml   (DA source storage)
 │
 ├─3─ POST admin.hlx.page/preview/{org}/{site}/main/video-sitemap.xml
 │
 └─4─ POST admin.hlx.page/live/{org}/{site}/main/video-sitemap.xml
          → sitemap is now live at <host>/video-sitemap.xml
```

The DA SDK token (IMS Bearer) is forwarded on all three API calls so the user's session is used — no separate auth token is needed.

## App States

| State       | Shown when                                               |
|-------------|----------------------------------------------------------|
| `idle`      | Initial load — toolbar with host input visible           |
| `generating`| Fetching `/video-index.json`                             |
| `done`      | XML ready — preview panel + Publish / Copy / Download    |
| `publishing`| Writing to DA, triggering preview, publishing to live    |
| `published` | Success — live URL shown with link to `/video-sitemap.xml` |
| `error`     | Fetch or publish API call failed — error message shown   |

## File Structure

| File                  | Description                                            |
|-----------------------|--------------------------------------------------------|
| `video-sitemap.html`  | Entry HTML — loads DA SDK and the app module           |
| `video-sitemap.js`    | LitElement component — fetch, build XML, publish/copy/download |
| `video-sitemap.css`   | Styles — light/dark theme, toolbar, XML preview, published state |
| `README.md`           | This file                                              |

## Relationship to `tools/generate-video-sitemap.js`

The CLI script (`tools/generate-video-sitemap.js`) writes `video-sitemap.xml` to disk and is used by the `.github/workflows/video-sitemap.yaml` daily CI workflow. This App Builder app is its browser-based, on-demand equivalent for content authors/editors inside DA — it publishes the sitemap directly to the live site via the AEM Admin API without touching the repository.
