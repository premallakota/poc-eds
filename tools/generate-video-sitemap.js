/* eslint-disable no-console */

/**
 * Generates video-sitemap.xml (Google video sitemap schema) from /video-index.json.
 * Run: node tools/generate-video-sitemap.js [host]
 * host defaults to the SITE_HOST env var, falling back to the production live host.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';
const host = process.argv[2] || process.env.SITE_HOST || DEFAULT_HOST;
const outputFile = path.join(__dirname, '..', 'video-sitemap.xml');

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

function buildEntry(row) {
  const loc = `${host}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');
  // Prefer the video block's own poster image, then the page image. The
  // legacy `thumbnail` field is a fallback for a known reindex gap where
  // `image` is blank for some already-indexed rows; safe to drop once the
  // index is confirmed to repopulate `image` for all rows.
  const rawThumbnail = row.videothumbnail || row.image || row.thumbnail;
  const thumbnail = rawThumbnail ? escapeXml(new URL(rawThumbnail, loc).href) : '';

  // video-feature embeds YouTube/Vimeo links as a player, not a direct file,
  // so those need player_loc rather than content_loc per Google's schema.
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

async function main() {
  const res = await fetch(`${host}/video-index.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch video-index.json: ${res.status} ${res.statusText}`);
  }
  const { data } = await res.json();

  // Only pages that actually have a video-feature block with a link count as
  // having a video (a page's og-style metadata alone is not enough).
  const videoRows = data.filter((row) => row.videourl);
  const entries = videoRows.map(buildEntry).join('\n');

  const xml = `<?xml version="1.0"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="https://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;

  fs.writeFileSync(outputFile, xml);
  console.log(`Wrote ${videoRows.length} video entries to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
