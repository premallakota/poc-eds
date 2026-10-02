import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import { fetchIndex, search, pathToBreadcrumb } from '../../scripts/search.js';

const isDesktop = window.matchMedia('(min-width: 900px)');
const DYNAMIC_NAV_LIMIT = 10;
// debounce delay (ms) between the last keystroke in the search box and
// firing the typeahead query — long enough to avoid a request per
// keystroke, short enough to still feel instant
const SEARCH_DEBOUNCE_MS = 200;
// max suggestions shown in the header typeahead
const SEARCH_SUGGESTION_LIMIT = 10;

/**
 * Strips a trailing slash so folder-index paths ("/foo/") and leaf paths
 * ("/foo/bar") from query-index.json compare consistently with authored
 * nav hrefs, which never include a trailing slash.
 * @param {string} path
 */
function normalizePath(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function isHiddenFromNav(entry) {
  return /^(true|yes|1)$/i.test((entry?.hidenav || '').trim());
}

/**
 * Loads query-index.json for nav decoration (dynamic link expansion,
 * hidenav pruning), sharing the same cached fetch the header search
 * typeahead uses (see scripts/search.js) rather than requesting it twice.
 * Returns null on failure so the nav still renders as authored.
 */
async function fetchNavIndex() {
  try {
    return await fetchIndex();
  } catch {
    return null;
  }
}

/**
 * Expands nav links ending in "/*" (e.g. /home/newsroom/stories/*) into a
 * live list of matching pages from query-index.json, newest first, so
 * authors don't have to hand-maintain a list of articles in the nav doc.
 * Pages flagged "hidenav" are excluded from the expansion.
 * @param {Element} nav The decorated nav element
 * @param {Array} pages Rows from query-index.json
 */
function expandDynamicNavLinks(nav, pages) {
  const dynamicLinks = [...nav.querySelectorAll('a[href$="/*"]')];
  if (dynamicLinks.length === 0 || !pages) return;

  dynamicLinks.forEach((link) => {
    const prefix = link.getAttribute('href').slice(0, -2);
    const matches = pages
      .filter((p) => p.path.startsWith(`${prefix}/`) && !isHiddenFromNav(p))
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
      .slice(0, DYNAMIC_NAV_LIMIT);

    const li = link.closest('li');
    if (!li || matches.length === 0) return;
    const items = matches.map((p) => {
      const item = document.createElement('li');
      const a = document.createElement('a');
      a.href = p.path;
      a.textContent = p.title || p.path;
      item.append(a);
      return item;
    });
    li.replaceWith(...items);
  });
}

/**
 * Removes nav list items whose link points to a page flagged "hidenav",
 * whether the link was authored directly or produced by dynamic expansion.
 * External/absolute-origin links (e.g. tools links to other sites) are left
 * alone since they're never in query-index.json.
 * @param {Element} nav The decorated nav element
 * @param {Array} pages Rows from query-index.json
 */
function removeHiddenNavLinks(nav, pages) {
  if (!pages) return;
  const hiddenPaths = new Set(
    pages.filter(isHiddenFromNav).map((p) => normalizePath(p.path)),
  );
  if (hiddenPaths.size === 0) return;

  nav.querySelectorAll('.nav-sections a[href], .nav-tools a[href]').forEach((a) => {
    const url = new URL(a.getAttribute('href'), window.location.href);
    if (url.origin !== window.location.origin) return;
    if (hiddenPaths.has(normalizePath(url.pathname))) {
      (a.closest('li') || a).remove();
    }
  });
}

function closeAllFlyouts(nav) {
  nav.querySelectorAll('.nav-item[aria-expanded="true"]').forEach((li) => {
    li.setAttribute('aria-expanded', 'false');
  });
}

/**
 * Opens the inline search overlay (replaces the nav-sections row, matching
 * aig.com) and moves focus into its input.
 * @param {Element} nav The nav element
 */
function openSearch(nav) {
  nav.setAttribute('data-search-open', 'true');
  nav.querySelector('.nav-search input')?.focus();
}

/**
 * Closes the inline search overlay, if open, and returns focus to the
 * trigger button that opened it.
 * @param {Element} nav The nav element
 */
function closeSearch(nav) {
  if (nav.getAttribute('data-search-open') !== 'true') return;
  nav.setAttribute('data-search-open', 'false');
  const input = nav.querySelector('.nav-search input');
  const suggestions = nav.querySelector('.nav-search-suggestions');
  if (suggestions) {
    suggestions.textContent = '';
    suggestions.hidden = true;
  }
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
  nav.querySelector('.nav-search-btn')?.focus();
}

function toggleMobileMenu(nav, forceClose) {
  const open = forceClose ? false : nav.getAttribute('aria-expanded') !== 'true';
  nav.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('nav-open', open);
  if (!open) {
    closeAllFlyouts(nav);
    closeSearch(nav);
  }
}

/**
 * @param {{path: string, title?: string}} entry A query-index row
 * @param {string} id The <li>'s element id, referenced by aria-activedescendant
 * @returns {Element} An <li role="option"> for the suggestions dropdown
 */
function renderSuggestion(entry, id) {
  const li = document.createElement('li');
  li.className = 'nav-search-suggestion';
  li.id = id;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', 'false');

  const link = document.createElement('a');
  link.href = entry.path;

  const title = document.createElement('span');
  title.className = 'nav-search-suggestion-title';
  title.textContent = entry.title || entry.path;

  const breadcrumb = document.createElement('span');
  breadcrumb.className = 'nav-search-suggestion-breadcrumb';
  breadcrumb.textContent = pathToBreadcrumb(entry.path);

  link.append(title, breadcrumb);
  li.append(link);
  return li;
}

/**
 * Builds the inline search overlay: a GET form (submits to /search-results
 * with the query in ?q=, so it works even before JS finishes loading, and
 * remains the fallback when Enter is pressed without picking a suggestion)
 * plus a live typeahead dropdown (top 10 results, title + breadcrumb,
 * redirects straight to the page on click) and a close button. The form
 * stays a real <form> rather than a JS fetch/redirect so the fallback
 * destination is just a normal, bookmarkable/shareable URL.
 * @returns {Element} The .nav-search container, not yet inserted
 */
function buildSearchOverlay() {
  const container = document.createElement('div');
  container.className = 'nav-search';

  const form = document.createElement('form');
  form.setAttribute('role', 'search');
  form.action = '/search-results';
  form.method = 'get';

  const input = document.createElement('input');
  input.type = 'search';
  input.name = 'q';
  input.placeholder = 'Search AIG';
  input.setAttribute('aria-label', 'Search AIG');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'nav-search-submit';
  submit.setAttribute('aria-label', 'Submit search');

  form.append(input, submit);

  const suggestionsId = `nav-search-suggestions-${Math.random().toString(36).slice(2, 8)}`;
  const suggestions = document.createElement('ul');
  suggestions.className = 'nav-search-suggestions';
  suggestions.id = suggestionsId;
  suggestions.setAttribute('role', 'listbox');
  suggestions.hidden = true;
  input.setAttribute('aria-controls', suggestionsId);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nav-search-close';
  close.setAttribute('aria-label', 'Close search');
  close.textContent = '×';

  container.append(form, suggestions, close);

  let debounceTimer;
  let activeIndex = -1;

  const clearSuggestions = () => {
    suggestions.textContent = '';
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const setActive = (index) => {
    const items = [...suggestions.children];
    items.forEach((item) => item.setAttribute('aria-selected', 'false'));
    activeIndex = index;
    const active = items[activeIndex];
    if (active) {
      active.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', active.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const runSearch = async (query) => {
    if (!query) {
      clearSuggestions();
      return;
    }
    let results;
    try {
      results = await search(query, SEARCH_SUGGESTION_LIMIT);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Header search: failed to load search index', error);
      clearSuggestions();
      return;
    }
    // the query may have changed while this was in flight — a stale,
    // out-of-order response shouldn't overwrite what the user is now typing
    if (input.value.trim() !== query) return;
    if (!results.length) {
      clearSuggestions();
      return;
    }
    suggestions.textContent = '';
    results.forEach((entry, index) => {
      suggestions.append(renderSuggestion(entry, `${suggestionsId}-option-${index}`));
    });
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    activeIndex = -1;
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    debounceTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (suggestions.hidden) return;
    const items = [...suggestions.children];
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      // a suggestion is highlighted — go straight there instead of falling
      // through to the form's default submit (the full results page)
      e.preventDefault();
      items[activeIndex].querySelector('a')?.click();
    }
  });

  // closing the dropdown when focus leaves the whole search container
  // (Tab away, or click the close button) — deferred a frame so a click on
  // a suggestion link still registers before it disappears
  container.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!container.contains(document.activeElement)) clearSuggestions();
    });
  });

  close.addEventListener('click', clearSuggestions);

  return container;
}

/**
 * loads and decorates the header nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);

  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.setAttribute('aria-label', 'Main navigation');
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);
  const pages = await fetchNavIndex();
  expandDynamicNavLinks(nav, pages);
  removeHiddenNavLinks(nav, pages);

  const sections = ['brand', 'sections', 'tools'];
  sections.forEach((c, i) => {
    const section = nav.children[i];
    if (section) section.classList.add(`nav-${c}`);
  });

  // Brand logo link
  const navBrand = nav.querySelector('.nav-brand');
  if (navBrand) {
    const brandLink = navBrand.querySelector('a');
    if (brandLink) brandLink.classList.add('nav-logo');
  }

  // Primary nav items with flyout panels
  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    const topList = navSections.querySelector('ul');
    if (topList) topList.classList.add('nav-list');
    navSections.querySelectorAll(':scope ul > li').forEach((li) => {
      // only treat top-level <li> (direct children of the primary list)
      if (li.parentElement !== topList) return;
      const submenu = li.querySelector(':scope > ul');
      li.classList.add('nav-item');
      if (submenu) {
        li.classList.add('nav-drop');
        li.setAttribute('aria-expanded', 'false');
        // Toggle button (the "+" affordance from source)
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-item-toggle';
        const labelLink = li.querySelector(':scope > a, :scope > p > a');
        toggle.setAttribute('aria-label', labelLink?.textContent || 'Toggle submenu');
        li.insertBefore(toggle, submenu);
        // Desktop: hover opens; click toggle expands (mobile)
        li.addEventListener('mouseenter', () => {
          if (isDesktop.matches) {
            closeAllFlyouts(nav);
            li.setAttribute('aria-expanded', 'true');
          }
        });
        li.addEventListener('mouseleave', () => {
          if (isDesktop.matches) li.setAttribute('aria-expanded', 'false');
        });
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          const expanded = li.getAttribute('aria-expanded') === 'true';
          if (!isDesktop.matches) closeAllFlyouts(nav);
          li.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        });
      }
    });
  }

  // Tools section: mark worldwide + login, build search control
  const navTools = nav.querySelector('.nav-tools');
  if (navTools) {
    const links = [...navTools.querySelectorAll('a')];
    links.forEach((a) => {
      if (/worldwide/i.test(a.getAttribute('href') || '')) a.classList.add('nav-worldwide');
      if (/login/i.test(a.textContent)) a.classList.add('nav-login');
    });
    // Search button (built in JS per DA-flat contract)
    const searchLi = document.createElement('li');
    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'nav-search-btn';
    searchBtn.setAttribute('aria-label', 'Search');
    searchBtn.addEventListener('click', () => openSearch(nav));
    searchLi.append(searchBtn);
    const toolsList = navTools.querySelector('ul');
    if (toolsList) toolsList.prepend(searchLi);

    const searchOverlay = buildSearchOverlay();
    searchOverlay.querySelector('.nav-search-close').addEventListener('click', () => closeSearch(nav));
    navTools.before(searchOverlay);
  }

  // Hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.classList.add('nav-hamburger');
  hamburger.innerHTML = `<button type="button" aria-controls="nav" aria-label="Open navigation">
      <span class="nav-hamburger-icon"></span>
    </button>`;
  hamburger.addEventListener('click', () => toggleMobileMenu(nav));
  nav.prepend(hamburger);
  nav.setAttribute('aria-expanded', 'false');

  // Close flyouts/search on outside click / escape
  document.addEventListener('click', (e) => {
    if (nav.contains(e.target)) return;
    if (isDesktop.matches) closeAllFlyouts(nav);
    closeSearch(nav);
  });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (nav.getAttribute('data-search-open') === 'true') {
      closeSearch(nav);
      return;
    }
    closeAllFlyouts(nav);
    if (!isDesktop.matches) toggleMobileMenu(nav, true);
  });

  // Reset state when crossing the breakpoint
  isDesktop.addEventListener('change', () => {
    closeAllFlyouts(nav);
    closeSearch(nav);
    toggleMobileMenu(nav, true);
  });

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}
