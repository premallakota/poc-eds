/**
 * Client-side search over the site's auto-generated page index (see
 * helix-query.yaml). Shared between the header's typeahead and the full
 * search-results page, so both search the exact same data the exact same
 * way, and shared with the header's nav decoration so /query-index.json is
 * only fetched once per page load.
 */

const INDEX_PATH = '/query-index.json';

let indexPromise;

/**
 * Loads /query-index.json, caching the in-flight/completed request so
 * repeated calls (nav decoration, every keystroke in the header typeahead)
 * don't each trigger their own fetch.
 * @returns {Promise<object[]>} The index rows
 */
export function fetchIndex() {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`${INDEX_PATH} returned ${res.status}`);
        return res.json();
      })
      .then((json) => json.data || [])
      .catch((error) => {
        indexPromise = null; // allow a retry on the next call
        throw error;
      });
  }
  return indexPromise;
}

/**
 * Entries whose path shouldn't surface as a result: fragments (nav/footer,
 * loaded into every page but not a destination themselves) and anything the
 * author has explicitly marked noindex.
 * @param {{path?: string, robots?: string}} entry A query-index row
 * @returns {boolean} Whether the entry is eligible to appear in results
 */
export function isSearchable(entry) {
  if (!entry.path) return false;
  if (entry.robots && /noindex/i.test(entry.robots)) return false;
  if (/^\/(nav|footer)(\/|$)/.test(entry.path)) return false;
  return true;
}

/**
 * @param {string} query A raw search query
 * @returns {string[]} Lowercased, whitespace-split search terms
 */
export function tokenize(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Scores an entry against the search terms: matches in the title count
 * most, then the description, then the page's body text, then the path.
 * Simple substring matching (no stemming/fuzziness) — sufficient for a
 * page-count this size and avoids pulling in a search library for a
 * client-side-only index with no server to do heavier lifting.
 *
 * Unlike an AEM-as-content-source setup, this project's index is built from
 * plain git/DA-authored markup, so a body-scoped selector (`bodyText` in
 * helix-query.yaml, selecting `main`) does show up in query-index.json —
 * matches there are real full-text search, not just metadata matching.
 * @param {{title?: string, description?: string, path?: string, bodyText?: string}} entry
 *   A query-index row
 * @param {string[]} terms Lowercased, whitespace-split search terms
 * @returns {number} Relevance score; 0 means no match
 */
export function scoreEntry(entry, terms) {
  const title = (entry.title || '').toLowerCase();
  const description = (entry.description || '').toLowerCase();
  const bodyText = (entry.bodyText || '').toLowerCase();
  const path = (entry.path || '').toLowerCase();
  return terms.reduce((score, term) => {
    let next = score;
    if (title.includes(term)) next += 5;
    if (description.includes(term)) next += 3;
    if (bodyText.includes(term)) next += 2;
    if (path.includes(term)) next += 1;
    return next;
  }, 0);
}

/**
 * Runs a query end-to-end: loads the index, scores/filters/sorts it, and
 * returns the top N matches.
 * @param {string} query A raw search query
 * @param {number} [limit] Max results to return; omit for all matches
 * @returns {Promise<object[]>} Matching query-index rows, highest score first
 */
export async function search(query, limit) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const entries = await fetchIndex();
  const results = entries
    .filter(isSearchable)
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
  return typeof limit === 'number' ? results.slice(0, limit) : results;
}

/**
 * Derives a display breadcrumb from a page's path, since the index has no
 * separate breadcrumb field — e.g. /home/risk-solutions/individual becomes
 * "Home > Risk Solutions > Individual". A leading "home" segment is dropped
 * rather than duplicated, since the "Home" prefix below already represents
 * it — without this, /home renders as the redundant "Home > Home".
 * @param {string} path A query-index entry's path
 * @returns {string} A human-readable breadcrumb
 */
export function pathToBreadcrumb(path) {
  const rawSegments = (path || '').split('/').filter(Boolean);
  if (rawSegments[0]?.toLowerCase() === 'home') rawSegments.shift();
  const segments = rawSegments.map((segment) => segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()));
  return ['Home', ...segments].join(' > ');
}
