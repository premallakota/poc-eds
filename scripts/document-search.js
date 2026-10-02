/**
 * Client-side search over DAM documents (PDF/Word/PowerPoint/Excel), proxied
 * through a small Vercel serverless function — the upstream AEM search
 * servlet requires credentials that must never reach the browser, so this
 * module never talks to AEM directly. Mirrors scripts/search.js's style
 * (plain functions, no external search library), but calls a live
 * server-side search rather than fetching a static index, since DAM
 * documents have no query-index.json equivalent.
 *
 * This project has no proxy of its own — it reuses the sibling
 * aig-aem-eds-poc project's already-deployed proxy, which talks to the same
 * AIG DAM instance. See docs/search.md for why, and what to change if this
 * project ever needs its own credentials/instance.
 */

const DOCUMENT_SEARCH_URL = 'https://aig-aem-eds-poc.vercel.app/api/search';

/**
 * The document formats the upstream servlet can actually search today.
 * `html` is a valid resultType there too, but currently always 400s in this
 * environment — the servlet's own limitation, not this proxy's.
 * @type {string[]}
 */
export const DOCUMENT_RESULT_TYPES = ['pdf', 'document', 'ppt', 'excel'];

/**
 * Display labels for each resultType, including the client-only "html"
 * value used to tag this project's own page-index results (see
 * blocks/search-results/search-results.js) so pages and documents can share
 * one format facet.
 * @type {Record<string, string>}
 */
export const RESULT_TYPE_LABELS = {
  html: 'Web Page',
  pdf: 'PDF',
  document: 'Document',
  ppt: 'PowerPoint',
  excel: 'Excel',
};

/**
 * @typedef {object} DocumentResult
 * @property {string} path
 * @property {string} title
 * @property {string} description
 * @property {string} resultType One of DOCUMENT_RESULT_TYPES
 * @property {string} mimeType
 * @property {string} lastModified ISO timestamp
 * @property {number} score Relevance score from the upstream servlet (its
 *   own scale — not comparable to this project's page-search scores without
 *   normalizing both first, see normalizeRank in search-results.js)
 */

/**
 * @param {object} raw A single row from the AEM search servlet's response
 * @returns {DocumentResult} Normalized to the path/title/description shape
 *   this project's search UI already expects, plus format metadata
 */
function normalize(raw) {
  return {
    path: raw.path || raw.url,
    title: raw.title || raw.path,
    description: raw.description || '',
    resultType: raw.resultType,
    mimeType: raw.mimeType,
    lastModified: raw.lastModified,
    score: raw.score,
  };
}

/**
 * Searches DAM documents via the Vercel proxy. Deliberately does not filter
 * by resultType server-side (even though the servlet supports it) — the
 * caller needs the full, unfiltered set to compute per-format facet counts
 * and to apply the format filter client-side without a network round trip
 * per toggle, the same way page search's facets work.
 * @param {string} query A raw search query
 * @param {number} [limit] Max results (1-50; the servlet defaults to 20)
 * @returns {Promise<DocumentResult[]>} Normalized document rows
 * @throws {Error} If the request fails or the servlet returns an error
 */
export async function searchDocuments(query, limit) {
  if (!query) return [];

  const url = new URL(DOCUMENT_SEARCH_URL);
  url.searchParams.set('q', query);
  if (limit) url.searchParams.set('limit', String(limit));

  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `${DOCUMENT_SEARCH_URL} returned ${res.status}`);
  }
  // the shared DAM instance behind this servlet also indexes asset types
  // outside this project's documented scope (e.g. plain images) — drop
  // anything that isn't one of the formats this UI actually knows how to
  // badge/facet, rather than rendering a broken "undefined" badge for it
  return (body?.results || [])
    .filter((raw) => DOCUMENT_RESULT_TYPES.includes(raw.resultType))
    .map(normalize);
}
