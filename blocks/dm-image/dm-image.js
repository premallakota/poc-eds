/*
 * Dynamic Media Image Block
 * Renders an AEM Dynamic Media asset (picked in DA.live via the "Insert AEM Asset"
 * toolbar action) as a responsive, optimized <picture>.
 */

// Matches public AEM as a Cloud Service Dynamic Media delivery hosts.
const DM_HOST_PATTERN = /^delivery-p\d+-e\d+\.adobeaemcloud\.com$/i;

const DEFAULT_WIDTHS = [320, 480, 768, 1024, 1600, 2000];
const DEFAULT_SIZES = '100vw';
const SUPPORTED_FALLBACK_FORMATS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);

function getFallbackFormat(assetUrl) {
  try {
    const extension = new URL(assetUrl, window.location.href).pathname
      .split('.')
      .pop()
      .toLowerCase();
    return SUPPORTED_FALLBACK_FORMATS.has(extension) ? extension : 'jpg';
  } catch {
    return 'jpg';
  }
}

/**
 * Checks whether a URL points at an AEM/Dynamic Media asset delivery host.
 * @param {string} href the URL to check
 * @returns {boolean} true if the URL's host matches the DM asset host pattern
 */
function isDmAssetHref(href) {
  try {
    const { hostname } = new URL(href, window.location.href);
    return DM_HOST_PATTERN.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Derives a human readable label from an asset URL's filename.
 * @param {string} url asset URL
 * @returns {string} filename without extension, with separators turned into spaces
 */
function filenameFromUrl(url) {
  try {
    const { pathname } = new URL(url, window.location.href);
    const filename = pathname.split('/').pop() || '';
    return filename.replace(/\.[^./]+$/, '').replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * Builds a responsive srcset for a Dynamic Media / AEM Assets delivery URL by
 * requesting one rendition per width via DM Open API style query params.
 * @param {string} assetUrl base asset delivery URL
 * @param {number[]} widths widths (in px) to request renditions for
 * @param {{format?: string, quality?: string}} [options] rendition options
 * @returns {{srcset: string, src: string, fallbackSrcset: string, fallbackSrc: string}}
 * srcset strings and default fallback sources
 */
export function buildDmSrcset(assetUrl, widths, {
  format = 'webply',
  fallbackFormat = getFallbackFormat(assetUrl),
  quality = 'medium',
} = {}) {
  const validWidths = [...new Set(widths)]
    .filter((width) => Number.isInteger(width) && width > 0)
    .sort((a, b) => a - b);
  if (!validWidths.length) {
    throw new Error('At least one positive image width is required');
  }

  const base = new URL(assetUrl, window.location.href);
  const variantUrl = (width) => {
    const variant = new URL(base);
    variant.searchParams.set('width', width);
    variant.searchParams.set('format', format);
    variant.searchParams.set('optimize', quality);
    return variant.toString();
  };
  const fallbackVariantUrl = (width) => {
    const variant = new URL(base);
    variant.searchParams.set('width', width);
    variant.searchParams.set('format', fallbackFormat);
    variant.searchParams.set('optimize', quality);
    return variant.toString();
  };
  const srcset = validWidths.map((width) => `${variantUrl(width)} ${width}w`).join(', ');
  const fallbackSrcset = validWidths
    .map((width) => `${fallbackVariantUrl(width)} ${width}w`)
    .join(', ');
  const defaultWidth = validWidths[Math.floor(validWidths.length / 2)];
  return {
    srcset,
    src: variantUrl(defaultWidth),
    fallbackSrcset,
    fallbackSrc: fallbackVariantUrl(defaultWidth),
  };
}

/**
 * Finds the row (direct child of the block) that contains a given element.
 * @param {Element} el descendant element
 * @param {Element} block the block element
 * @returns {Element|null} the row, or null if el is falsy
 */
function findRow(el, block) {
  let node = el;
  while (node && node.parentElement !== block) {
    node = node.parentElement;
  }
  return node;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  // Search the whole block rather than assuming a fixed row position: some
  // authoring paths (e.g. inserting via the block library) carry an extra
  // leading text row ahead of the actual image/link row.
  const img = block.querySelector('img');
  const anchor = block.querySelector('a');

  let assetUrl = '';
  let alt = '';
  let mediaRow = null;
  if (img) {
    assetUrl = img.currentSrc || img.src;
    if (isDmAssetHref(assetUrl)) {
      alt = img.alt || '';
      mediaRow = findRow(img, block);
    } else {
      assetUrl = '';
    }
  } else if (anchor && isDmAssetHref(anchor.href)) {
    assetUrl = anchor.href;
    const linkText = anchor.textContent.trim();
    // DA.live's link-mode picker uses the raw filename as link text; humanize
    // it the same way a missing alt/caption falls back to the filename.
    alt = /\.[a-z0-9]{2,4}$/i.test(linkText) ? filenameFromUrl(linkText) : linkText;
    mediaRow = findRow(anchor, block);
  }

  if (!assetUrl) {
    // eslint-disable-next-line no-console
    console.warn('[dm-image] no image or Dynamic Media asset link found in block; leaving content as authored.', block);
    return;
  }

  const rows = [...block.children];
  const lastRow = rows[rows.length - 1];
  const captionText = (lastRow && lastRow !== mediaRow) ? lastRow.textContent.trim() : '';
  if (!alt) alt = captionText || filenameFromUrl(assetUrl);

  const {
    srcset,
    fallbackSrcset,
    fallbackSrc,
  } = buildDmSrcset(assetUrl, DEFAULT_WIDTHS);

  const picture = document.createElement('picture');
  const source = document.createElement('source');
  source.type = 'image/webp';
  source.setAttribute('srcset', srcset);
  source.setAttribute('sizes', DEFAULT_SIZES);
  picture.append(source);

  const fallbackImg = document.createElement('img');
  fallbackImg.src = fallbackSrc;
  fallbackImg.setAttribute('srcset', fallbackSrcset);
  fallbackImg.setAttribute('sizes', DEFAULT_SIZES);
  fallbackImg.alt = alt;
  fallbackImg.loading = 'lazy';
  picture.append(fallbackImg);

  block.textContent = '';
  block.append(picture);

  if (captionText) {
    const caption = document.createElement('p');
    caption.className = 'dm-image-caption';
    caption.textContent = captionText;
    block.append(caption);
  }
}
