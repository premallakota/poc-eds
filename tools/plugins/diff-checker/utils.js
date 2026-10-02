const DIFF_SITE_URL = 'https://pianomister.github.io/diffsite/';

/**
 * Builds the preview and live URLs for the current page, along with a link
 * to the diff checker site, so the user can compare the two.
 * @param {object} context DA SDK context, e.g. { org, site, path, ref }
 */
export function buildDiffLinks({
  org, site, path, ref = 'main',
}) {
  const previewUrl = `https://${ref}--${site}--${org}.aem.page${path}`;
  const liveUrl = `https://${ref}--${site}--${org}.aem.live${path}`;
  const diffSiteUrl = `${DIFF_SITE_URL}?url1=${encodeURIComponent(previewUrl)}&url2=${encodeURIComponent(liveUrl)}`;

  return { diffSiteUrl, previewUrl, liveUrl };
}
