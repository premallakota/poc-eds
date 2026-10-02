# Video Sitemap Generator App

An **AEM Document Authoring (DA) App** that generates a **Google Video Sitemap XML** on-demand from the project's `/video-index.json` and publishes it directly to `/video-sitemap.xml` on the live site — **no repo commit or local Node.js environment required**.

---

## What is DA App Builder? (Is it built into EDS?)

**Short answer: No — but it is built into [da.live](https://da.live), which is the Document Authoring platform that sits alongside EDS.**

| Platform | What it is |
|----------|-----------|
| **EDS (Edge Delivery Services)** | The content delivery layer — renders pages from Google Docs/SharePoint source using blocks, scripts, and styles in your GitHub repo |
| **DA (Document Authoring / da.live)** | Adobe's browser-based authoring shell — replaces the raw Google Docs / SharePoint UI with a richer editing experience; manages source files via `admin.da.live` |
| **DA App Builder** | A **micro-app extensibility framework built into da.live** — any HTML/JS/CSS file placed under `tools/apps/<name>/` in your EDS repo can be loaded as a first-class app inside the DA shell at `https://da.live/app/{org}/{repo}/tools/apps/<name>/<name>` |

### DA App Builder vs Adobe App Builder

These are **two completely different things**:

| | DA App Builder | Adobe App Builder (legacy) |
|--|----------------|---------------------------|
| **What** | Micro-app iframes embedded in da.live | Serverless Node.js apps on Adobe I/O Runtime |
| **Auth** | Uses DA's own IMS session token (passed via `DA_SDK`) | Requires separate Adobe I/O credentials / OAuth |
| **Hosting** | Your GitHub repo (EDS serves the files) | Adobe I/O Runtime / cloud |
| **Tech** | Plain HTML + ES modules (LitElement, Shoelace) | Node.js, React, Express |
| **Purpose** | Extend the DA authoring shell with custom tooling | Build full serverless apps on Adobe's platform |

### How DA App Builder works with EDS

```
GitHub Repo (poc-eds)
  └── tools/apps/video-sitemap/
        ├── video-sitemap.html   ← entry point (loaded in DA iframe)
        ├── video-sitemap.js     ← LitElement component
        └── video-sitemap.css    ← styles

EDS serves these files at:
  https://main--poc-eds--premallakota.aem.live/tools/apps/video-sitemap/...

DA shell loads the app at:
  https://da.live/app/premallakota/poc-eds/tools/apps/video-sitemap/video-sitemap
         ↑ DA host       ↑ org   ↑ repo    ↑ path to your HTML entry point
```

The DA SDK (`https://da.live/nx/utils/sdk.js`) provides `context` (org, repo, path) and `token` (IMS auth token) to the app so it can call the AEM Admin API on behalf of the signed-in user.

**Requirement to publish:** The user must be **signed in to da.live** — the sign-in provides the IMS token used for `admin.hlx.page` calls.

---

## How It Works

1. The app fetches `/video-index.json` from the app iframe's own origin to avoid cross-origin requests. An app hosted on an EDS preview origin reads the preview index, not the live index. The configured EDS host is still used for sitemap page URLs.
2. It filters rows that contain a non-empty `videourl` column.
3. It builds a valid `video-sitemap.xml` string in memory using the Google Video Sitemap schema.
4. The result is displayed in a scrollable code preview inside the DA iframe.
5. The user clicks **"Publish to /video-sitemap.xml"**, which runs three steps automatically:
   - **Write to DA source** — `PUT https://admin.da.live/source/{org}/{site}/video-sitemap.xml`
   - **Trigger preview** — `POST https://admin.hlx.page/preview/{org}/{site}/main/video-sitemap.xml`
   - **Publish to live** — `POST https://admin.hlx.page/live/{org}/{site}/main/video-sitemap.xml`
6. The sitemap is now live at `<host>/video-sitemap.xml`.

Alternatively, use **Copy XML** or **Download** to get the raw XML without publishing.

The iframe must be hosted on the EDS site serving the index. A redirect to another origin can still require server-side CORS configuration; `mode: 'no-cors'` cannot provide readable JSON.

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
| `host`    | No       | Override the canonical host for sitemap page URLs and the displayed live sitemap URL (e.g. `https://main--myrepo--myorg.aem.live`). If omitted the app derives the host from the DA context (`org`/`repo`). This does not change the index fetch origin. |

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
 ├─1─ GET  <iframe-origin>/video-index.json → filter videourl rows → build XML in memory
 │
 ├─2─ PUT  admin.da.live/source/{org}/{site}/video-sitemap.xml   (DA source storage)
 │
 ├─3─ POST admin.hlx.page/preview/{org}/{site}/main/video-sitemap.xml
 │
 └─4─ POST admin.hlx.page/live/{org}/{site}/main/video-sitemap.xml
          → sitemap is now live at <host>/video-sitemap.xml
```

The DA SDK token (IMS Bearer) is sent as `Authorization` on all three API calls. Preview and live requests also send `x-content-source-authorization` so AEM can read the DA source. The signed-in user must have the site's required preview and publish permissions.

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

## DA-Only Generation

This app is the only video sitemap generation and publishing process. The generated XML is stored in DA source and previewed and published as `/video-sitemap.xml`; it is not stored in Git. Regenerate and publish from the app after changing video content. There is no scheduled video sitemap workflow or local CLI generator. The page sitemap and article RSS feed retain their existing processes.
