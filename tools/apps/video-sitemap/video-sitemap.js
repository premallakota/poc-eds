/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable no-console, import/no-unresolved, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';

// ---------------------------------------------------------------------------
// NX / Spectrum-Lite style pipeline (same pattern as publish-requests-inbox)
// ---------------------------------------------------------------------------
const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;
let styles = null;
try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
  await Promise.all([
    loadStyle(`${NX}/styles/styles.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load NX styles:', e);
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isEmbedPlayerUrl(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
}

function buildEntry(row, host) {
  const loc = `${host}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');
  const rawThumbnail = row.videothumbnail || row.image || row.thumbnail;
  const thumbnail = rawThumbnail ? escapeXml(new URL(rawThumbnail, loc).href) : '';

  const locTag = isEmbedPlayerUrl(row.videourl)
    ? `<video:player_loc allow_embed="yes">${escapeXml(row.videourl)}</video:player_loc>`
    : `<video:content_loc>${escapeXml(row.videourl)}</video:content_loc>`;

  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <video:video>
      <video:title>${title}</video:title>
      <video:description>${description}</video:description>
      ${locTag}
      <video:thumbnail_loc>${thumbnail}</video:thumbnail_loc>
    </video:video>
  </url>`;
}

function buildXml(rows, host) {
  const entries = rows.map((r) => buildEntry(r, host)).join('\n');
  return `<?xml version="1.0"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="https://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;
}

// ---------------------------------------------------------------------------
// Derive EDS host and org/site from DA context or URL params
// ---------------------------------------------------------------------------
function resolveHost(context, urlParams) {
  const hostParam = urlParams.get('host');
  if (hostParam) return hostParam.replace(/\/$/, '');
  if (context?.org && context?.repo) {
    return `https://main--${context.repo}--${context.org}.aem.live`;
  }
  return 'https://main--poc-eds--premallakota.aem.live';
}

function resolveOrgSite(context) {
  if (context?.org && context?.repo) return { org: context.org, site: context.repo };
  return { org: 'premallakota', site: 'poc-eds' };
}

// ---------------------------------------------------------------------------
// DA / AEM Admin API helpers
// ---------------------------------------------------------------------------

/**
 * Write XML to DA source storage.
 * DA SDK token is an IMS Bearer token → use admin.da.live with Authorization: Bearer <token>
 * Path format: /{org}/{site}/video-sitemap.xml  (no branch in DA source path)
 */
async function writeToDA(org, site, xml, token) {
  const url = `https://admin.da.live/source/${org}/${site}/video-sitemap.xml`;
  const blob = new Blob([xml], { type: 'application/xml' });
  const form = new FormData();
  form.append('data', blob, 'video-sitemap.xml');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DA source write failed (${res.status}): ${text || res.statusText}`);
  }
}

/**
 * Trigger AEM preview for /video-sitemap.xml via admin.hlx.page
 */
async function triggerPreview(org, site, token) {
  const url = `https://admin.hlx.page/preview/${org}/${site}/main/video-sitemap.xml`;
  const res = await fetch(url, {
    method: 'POST',
    headers: token ? {
      Authorization: `Bearer ${token}`,
      'x-content-source-authorization': `Bearer ${token}`,
    } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Preview failed (${res.status}): ${text || res.statusText}`);
  }
}

/**
 * Publish /video-sitemap.xml to the live site via admin.hlx.page
 */
async function publishToLive(org, site, token) {
  const url = `https://admin.hlx.page/live/${org}/${site}/main/video-sitemap.xml`;
  const res = await fetch(url, {
    method: 'POST',
    headers: token ? {
      Authorization: `Bearer ${token}`,
      'x-content-source-authorization': `Bearer ${token}`,
    } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Publish failed (${res.status}): ${text || res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Web Component
// ---------------------------------------------------------------------------
class VideoSitemapApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    // states: 'loading' | 'idle' | 'generating' | 'done' | 'publishing' | 'published' | 'error'
    _state: { state: true },
    _hostValue: { state: true },
    _xml: { state: true },
    _entryCount: { state: true },
    _errorMsg: { state: true },
    _copied: { state: true },
    _publishStep: { state: true },
    _liveUrl: { state: true },
  };

  constructor() {
    super();
    this._state = 'loading';
    this._hostValue = '';
    this._xml = '';
    this._entryCount = 0;
    this._errorMsg = '';
    this._copied = false;
    this._publishStep = '';
    this._liveUrl = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
    this._init();
  }

  _init() {
    const urlParams = new URLSearchParams(window.location.search);
    this._hostValue = resolveHost(this.context, urlParams);
    console.log('[video-sitemap] context:', JSON.stringify(this.context));
    console.log('[video-sitemap] token present:', !!this.token, 'len:', this.token?.length ?? 0);
    this._state = 'idle';
  }

  // -------------------------------------------------------------------------
  // Step 1: Generate sitemap XML from /video-index.json
  // -------------------------------------------------------------------------
  get _indexUrl() {
    return new URL('/video-index.json', window.location.origin).href;
  }

  async _generate() {
    const host = (this._hostValue || '').trim().replace(/\/$/, '');
    if (!host) {
      this._errorMsg = 'Please enter a valid EDS host URL.';
      this._state = 'error';
      return;
    }

    this._state = 'generating';
    this._xml = '';
    this._errorMsg = '';
    this._copied = false;
    this._publishStep = '';
    this._liveUrl = '';

    try {
      const url = this._indexUrl;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data : [];
      const videoRows = data.filter((row) => row.videourl);

      if (videoRows.length === 0) {
        this._errorMsg = `No video entries found at ${url}. Make sure video-index.json exists and contains rows with a "videourl" column.`;
        this._state = 'error';
        return;
      }

      this._xml = buildXml(videoRows, host);
      this._entryCount = videoRows.length;
      this._state = 'done';
    } catch (err) {
      console.error('[video-sitemap] generate:', err);
      this._errorMsg = err instanceof TypeError
        ? `Could not fetch ${this._indexUrl}. Check the browser Network panel for CORS, redirects, or connection errors. ${err.message}`
        : err.message;
      this._state = 'error';
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Publish XML → source → preview → live (/video-sitemap.xml)
  // -------------------------------------------------------------------------
  async _publishXml() {
    // Require authentication — the DA SDK token is only available when the
    // user is signed in to da.live. Without it all admin API calls fail.
    if (!this.token) {
      this._errorMsg = 'You must be signed in to DA to publish. Please click "Sign in" at the top-right of the DA shell, then try again.';
      this._state = 'error';
      return;
    }

    const { org, site } = resolveOrgSite(this.context);
    const host = (this._hostValue || '').trim().replace(/\/$/, '');

    this._state = 'publishing';
    this._errorMsg = '';

    try {
      this._publishStep = 'Writing to DA source…';
      this.requestUpdate();
      await writeToDA(org, site, this._xml, this.token);

      this._publishStep = 'Triggering preview…';
      this.requestUpdate();
      await triggerPreview(org, site, this.token);

      this._publishStep = 'Publishing to live…';
      this.requestUpdate();
      await publishToLive(org, site, this.token);

      this._liveUrl = `${host}/video-sitemap.xml`;
      this._state = 'published';
    } catch (err) {
      console.error('[video-sitemap] publish:', err);
      this._errorMsg = `${this._publishStep} ${err.message}`;
      this._state = 'error';
    }
  }

  // -------------------------------------------------------------------------
  // Copy to clipboard
  // -------------------------------------------------------------------------
  async _copyXml() {
    try {
      await navigator.clipboard.writeText(this._xml);
      this._copied = true;
      setTimeout(() => { this._copied = false; }, 2500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Download XML file
  // -------------------------------------------------------------------------
  _downloadXml() {
    const blob = new Blob([this._xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'video-sitemap.xml';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  _renderToolbar() {
    return html`
      <div class="vs-toolbar">
        <header class="vs-header">
          <h1 class="vs-title">Video Sitemap Generator</h1>
          <p class="vs-subtitle">
            Generates a Google Video Sitemap from
            <code>/video-index.json</code> and publishes it live at
            <code>/video-sitemap.xml</code> — no repo commit required.
          </p>
        </header>

        <div class="vs-form">
          <div class="vs-field vs-field--grow">
            <label class="vs-label" for="host-input">EDS Host</label>
            <sl-input
              id="host-input"
              type="url"
              placeholder="https://main--repo--org.aem.live"
              autocomplete="off"
              aria-label="EDS host URL"
              .value=${this._hostValue}
              @input=${(e) => { this._hostValue = e.target.value; }}
              @keydown=${(e) => { if (e.key === 'Enter') this._generate(); }}
            ></sl-input>
          </div>
          <sl-button
            class="vs-generate-btn pw-fill-accent"
            @click=${() => this._generate()}
            ?disabled=${this._state === 'generating' || this._state === 'publishing'}
          >
            ${this._state === 'generating' ? 'Generating…' : 'Generate Sitemap'}
          </sl-button>
        </div>
      </div>
    `;
  }

  _renderLoading() {
    return html`
      <div class="vs-status" role="status" aria-live="polite" aria-busy="true">
        <div class="vs-spinner" aria-hidden="true"></div>
        <p>Loading…</p>
      </div>
    `;
  }

  _renderGenerating() {
    return html`
      <div class="vs-status" role="status" aria-live="polite" aria-busy="true">
        <div class="vs-spinner" aria-hidden="true"></div>
        <p>Fetching <code>${this._indexUrl}</code>…</p>
      </div>
    `;
  }

  _renderPublishing() {
    return html`
      <div class="vs-status" role="status" aria-live="polite" aria-busy="true">
        <div class="vs-spinner" aria-hidden="true"></div>
        <p>${this._publishStep || 'Publishing…'}</p>
      </div>
    `;
  }

  _renderError() {
    return html`
      <div class="vs-message vs-message--error" role="alert">
        <svg class="vs-icon" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M9 1a8 8 0 1 0 8 8A8 8 0 0 0 9 1Zm0 13a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0Z"/>
        </svg>
        <span>${this._errorMsg}</span>
      </div>
      <div class="vs-result-footer" style="margin-top:16px">
        <sl-button class="pw-quiet-secondary" @click=${() => { this._state = 'idle'; }}>
          ← Try again
        </sl-button>
      </div>
    `;
  }

  _renderPublished() {
    return html`
      <div class="vs-published">
        <div class="vs-published-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.5 17.5L3.5 11.5l1.41-1.41L9.5 14.67l9.59-9.59L20.5 6.5z" fill="currentColor"/>
          </svg>
        </div>
        <h2 class="vs-published-heading">Published!</h2>
        <p class="vs-published-body">
          The video sitemap is now live at
          <a class="vs-live-link" href="${this._liveUrl}" target="_blank" rel="noopener">
            ${this._liveUrl}
          </a>
        </p>
        <div class="vs-published-actions">
          <sl-button
            class="pw-fill-accent"
            @click=${() => window.open(this._liveUrl, '_blank')}
          >
            <svg class="vs-icon" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/>
            </svg>
            View /video-sitemap.xml
          </sl-button>
          <sl-button
            class="pw-quiet-secondary"
            @click=${() => { this._state = 'done'; }}
          >
            ← Back to preview
          </sl-button>
        </div>
      </div>
    `;
  }

  _renderDone() {
    return html`
      <div class="vs-result">
        <div class="vs-result-header">
          <div class="vs-result-meta">
            <svg class="vs-icon vs-icon--success" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M9 1a8 8 0 1 0 8 8A8 8 0 0 0 9 1Zm-1 11.41-3.7-3.7 1.41-1.42L8 9.59l4.29-4.3 1.42 1.42Z"/>
            </svg>
            <span>
              Generated <strong>${this._entryCount}</strong>
              video ${this._entryCount === 1 ? 'entry' : 'entries'} from
              <code>${this._indexUrl}</code>
            </span>
          </div>
          <div class="vs-result-actions">
            ${!this.token ? html`
              <div class="vs-signin-warning">
                ⚠️ Not signed in — go to
                <a href="https://da.live" target="_top" style="color:inherit;font-weight:700;text-decoration:underline;">da.live</a>,
                sign in, then
                <button style="margin-left:4px;cursor:pointer;font-size:0.82rem;padding:2px 8px;border-radius:4px;border:1px solid currentColor;background:transparent;color:inherit;" onclick="window.location.reload()">reload page</button>
              </div>
            ` : nothing}
            <sl-button class="pw-quiet-secondary vs-action-btn" @click=${() => this._copyXml()}>
              ${this._copied
                ? html`<svg class="vs-icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M7 13.41 2.59 9 4 7.59 7 10.58l7-7L15.41 5Z"/></svg> Copied!`
                : html`<svg class="vs-icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M13 1H5a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V5Zm-1 14H3V4h1v10a1 1 0 0 0 1 1h7Zm2-2H5V2h8Z"/></svg> Copy XML`}
            </sl-button>
            <sl-button class="pw-quiet-secondary vs-action-btn" @click=${() => this._downloadXml()}>
              <svg class="vs-icon" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M15 12v3H3v-3H1v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3ZM9 12l4-4.59L11.59 6 10 7.59V1H8v6.59L6.41 6 5 7.41Z"/>
              </svg>
              Download
            </sl-button>
            <sl-button
              class="pw-fill-accent vs-action-btn"
              @click=${() => this._publishXml()}
            >
              <svg class="vs-icon" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 1 5 7h3v6h2V7h3L9 1ZM2 15h14v2H2z"/>
              </svg>
              Publish to /video-sitemap.xml
            </sl-button>
          </div>
        </div>

        <div class="vs-xml-preview">
          <pre class="vs-xml-code"><code>${this._xml}</code></pre>
        </div>

        <div class="vs-result-footer">
          <sl-button
            class="pw-quiet-secondary"
            @click=${() => { this._state = 'idle'; this._xml = ''; }}
          >
            ← Generate again
          </sl-button>
        </div>
      </div>
    `;
  }

  _renderContent() {
    switch (this._state) {
      case 'loading': return this._renderLoading();
      case 'generating': return this._renderGenerating();
      case 'publishing': return this._renderPublishing();
      case 'published': return this._renderPublished();
      case 'error': return this._renderError();
      case 'done': return this._renderDone();
      default: return nothing; // idle — just the toolbar
    }
  }

  render() {
    if (this._state === 'loading') return this._renderLoading();
    return html`
      ${this._renderToolbar()}
      <div class="vs-content">
        ${this._renderContent()}
      </div>
    `;
  }
}

customElements.define('video-sitemap-app', VideoSitemapApp);

(async function init() {
  const { context, token } = await DA_SDK;
  const cmp = document.createElement('video-sitemap-app');
  cmp.context = context;
  cmp.token = token;
  document.body.append(cmp);
}());
