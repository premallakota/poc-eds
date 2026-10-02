import {
  fetchIndex, isSearchable, scoreEntry, tokenize, pathToBreadcrumb,
} from '../../scripts/search.js';
import {
  searchDocuments, DOCUMENT_RESULT_TYPES, RESULT_TYPE_LABELS,
} from '../../scripts/document-search.js';

const FORMAT_PARAM = 'format';
const DOCUMENT_FETCH_LIMIT = 50; // the servlet's own maximum
const ALL_RESULT_TYPES = ['html', ...DOCUMENT_RESULT_TYPES];

/**
 * Loads and scores the page index (see scripts/search.js), tagging each
 * match with resultType "html" so it can share one format facet with DAM
 * documents below.
 * @param {string} query A raw search query
 * @returns {Promise<object[]>} Matching page entries, unranked
 */
async function searchPages(query) {
  const terms = tokenize(query);
  const entries = await fetchIndex();
  return entries
    .filter(isSearchable)
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter(({ score }) => score > 0)
    .map(({ entry, score }) => ({ ...entry, resultType: 'html', score }));
}

/**
 * Normalizes a source's own relevance scores to a 0-1 scale, relative to
 * the best match within that same source, before merging with another
 * source. Page-search scores (small integers from scoreEntry) and the AEM
 * servlet's own relevance scores are on entirely different, incomparable
 * scales — merging by raw score would rank a mediocre page above a strong
 * document match. This doesn't produce a "true" unified ranking, just a
 * reasonable blended one across two independently-scored sources.
 * @param {{score: number}[]} results
 * @returns {object[]} The same entries with a comparable 0-1 `rank` added
 */
function normalizeRank(results) {
  const max = results.reduce((best, { score }) => Math.max(best, score), 0);
  return results.map((entry) => ({ ...entry, rank: max ? entry.score / max : 0 }));
}

/**
 * Runs both searches in parallel and merges them into one ranked list.
 * Each source can fail independently (Promise.allSettled) — a document
 * search outage shouldn't also hide working page results, or vice versa.
 * @param {string} query A raw search query
 * @returns {Promise<{results: object[], failures: string[]}>}
 */
async function runSearch(query) {
  const [pages, documents] = await Promise.allSettled([
    searchPages(query),
    searchDocuments(query, DOCUMENT_FETCH_LIMIT),
  ]);

  const failures = [];
  const merged = [];

  if (pages.status === 'fulfilled') merged.push(...normalizeRank(pages.value));
  else failures.push('pages');

  if (documents.status === 'fulfilled') merged.push(...normalizeRank(documents.value));
  else failures.push('documents');

  merged.sort((a, b) => b.rank - a.rank);
  return { results: merged, failures };
}

/**
 * @param {object[]} results The full, unfiltered merged result set
 * @returns {Record<string, number>} Result count per resultType
 */
function countByType(results) {
  return results.reduce((counts, entry) => {
    counts[entry.resultType] = (counts[entry.resultType] || 0) + 1;
    return counts;
  }, {});
}

/**
 * @param {{path: string, title?: string, description?: string, resultType: string,
 *   lastModified?: string}} entry A merged page or document result
 * @returns {Element} An <li> for the results list
 */
function renderResult(entry) {
  const li = document.createElement('li');
  li.className = 'search-results-item';

  const badge = document.createElement('span');
  badge.className = `search-results-item-badge search-results-item-badge-${entry.resultType}`;
  badge.textContent = RESULT_TYPE_LABELS[entry.resultType] || entry.resultType;
  li.append(badge);

  if (entry.resultType === 'html') {
    const breadcrumb = document.createElement('p');
    breadcrumb.className = 'search-results-item-breadcrumb';
    breadcrumb.textContent = pathToBreadcrumb(entry.path);
    li.append(breadcrumb);
  }

  const link = document.createElement('a');
  link.href = entry.path;

  const title = document.createElement('p');
  title.className = 'search-results-item-title';
  title.textContent = entry.title || entry.path;
  link.append(title);
  li.append(link);

  if (entry.description) {
    const description = document.createElement('p');
    description.className = 'search-results-item-description';
    description.textContent = entry.description;
    li.append(description);
  }

  if (entry.resultType !== 'html' && entry.lastModified) {
    const year = document.createElement('p');
    year.className = 'search-results-item-year';
    year.textContent = `Year: ${new Date(entry.lastModified).getFullYear()}`;
    li.append(year);
  }

  return li;
}

/**
 * Builds the "Refine Result" format facet panel. Counts are computed once
 * from the full unfiltered result set and don't change as checkboxes are
 * toggled (there's only one facet dimension here, so a box's own count
 * isn't affected by any other box in the same group).
 * @param {Record<string, number>} counts Result count per resultType
 * @param {Set<string>} selected Currently-checked resultType values
 * @param {(type: string, checked: boolean) => void} onChange
 * @returns {Element} The facets panel
 */
function renderFacets(counts, selected, onChange) {
  const panel = document.createElement('div');
  panel.className = 'search-results-facets';

  const heading = document.createElement('h2');
  heading.className = 'search-results-facets-heading';
  heading.textContent = 'Refine Result';
  panel.append(heading);

  const list = document.createElement('ul');
  list.className = 'search-results-facets-list';

  ALL_RESULT_TYPES.forEach((type) => {
    const count = counts[type] || 0;
    const li = document.createElement('li');
    const label = document.createElement('label');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = type;
    checkbox.checked = selected.has(type);
    checkbox.disabled = count === 0;
    checkbox.addEventListener('change', () => onChange(type, checkbox.checked));

    const text = document.createElement('span');
    text.textContent = `${RESULT_TYPE_LABELS[type] || type} (${count})`;

    label.append(checkbox, text);
    li.append(label);
    list.append(li);
  });

  panel.append(list);
  return panel;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  block.textContent = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'search-results-wrapper';

  const form = document.createElement('form');
  form.className = 'search-results-form';
  form.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.name = 'q';
  input.placeholder = 'Search AIG';
  input.setAttribute('aria-label', 'Search AIG');
  form.append(input);

  const meta = document.createElement('p');
  meta.className = 'search-results-meta';
  meta.setAttribute('aria-live', 'polite');

  const layout = document.createElement('div');
  layout.className = 'search-results-layout';

  const list = document.createElement('ul');
  list.className = 'search-results-list';

  wrapper.append(form, meta, layout);
  block.append(wrapper);

  const params = new URLSearchParams(window.location.search);
  const query = (params.get('q') || '').trim();
  input.value = query;

  const selectedFormats = new Set(
    (params.get(FORMAT_PARAM) || '').split(',').map((value) => value.trim()).filter(Boolean),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set('q', value);
    } else {
      url.searchParams.delete('q');
    }
    window.location.href = url.toString();
  });

  if (!query) {
    meta.textContent = 'Enter a search term above to get started.';
    return;
  }

  meta.textContent = 'Searching…';

  let results;
  let failures;
  try {
    ({ results, failures } = await runSearch(query));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Search results: search failed', error);
    meta.textContent = 'Search is temporarily unavailable. Please try again later.';
    return;
  }

  const counts = countByType(results);

  /**
   * Re-filters the already-fetched merged results by the current facet
   * selection and re-renders the list — no network request, since toggling
   * a format is just narrowing a set already in memory.
   */
  function renderFiltered() {
    const filtered = selectedFormats.size
      ? results.filter((entry) => selectedFormats.has(entry.resultType))
      : results;

    list.textContent = '';
    filtered.forEach((entry) => list.append(renderResult(entry)));

    const countText = `${filtered.length} result${filtered.length === 1 ? '' : 's'} for "${query}"`;
    const failureText = failures.length
      ? ` (${failures.join(' and ')} search temporarily unavailable)`
      : '';
    meta.textContent = countText + failureText;
  }

  function onFacetChange(type, checked) {
    if (checked) selectedFormats.add(type);
    else selectedFormats.delete(type);

    const url = new URL(window.location.href);
    if (selectedFormats.size) {
      url.searchParams.set(FORMAT_PARAM, [...selectedFormats].join(','));
    } else {
      url.searchParams.delete(FORMAT_PARAM);
    }
    window.history.replaceState(null, '', url);

    renderFiltered();
  }

  const facets = renderFacets(counts, selectedFormats, onFacetChange);
  layout.append(facets, list);
  renderFiltered();
}
