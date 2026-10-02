/* eslint-disable no-console */

/**
 * Generates article-really-simple-syndication.rss (RSS 2.0) from
 * /article-index.json, matching the real aig.com production feed format
 * (https://www.aig.com/article-really-simple-syndication.rss): channel
 * title/description/link/copyright/lastBuildDate/pubDate, and per item only
 * title/description/link/pubDate, in that order.
 *
 * Only pages under the /articles/ folder that also carry
 * `template: Article Template` are included - the folder is the structural
 * boundary, the template is the authoring signal, both must agree.
 *
 * Run: node tools/generate-article-rss.js [host]
 * host defaults to the SITE_HOST env var, falling back to the production
 * live host.
 */

const fs = require('fs');
const path = require('path');

const ARTICLE_TEMPLATE = 'Article Template';
const ARTICLE_FOLDER = '/articles/';
const DEFAULT_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';
const host = process.argv[2] || process.env.SITE_HOST || DEFAULT_HOST;
const outputFile = path.join(__dirname, '..', 'article-really-simple-syndication.rss');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toFeedDate(value) {
  const date = value ? new Date(value) : new Date();
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return iso.replace('Z', '+0000');
}

// lastModified comes out of the index as a Unix timestamp in seconds, not
// milliseconds like Date() expects, and only applies when no author-entered
// publishdate exists.
function resolvePubDate(row) {
  if (row.publishdate) return toFeedDate(row.publishdate);
  if (row.lastModified) return toFeedDate(row.lastModified * 1000);
  return toFeedDate();
}

function isArticle(row) {
  const isArticleTemplate = (row.template || '').trim().toLowerCase() === ARTICLE_TEMPLATE.toLowerCase();
  const isUnderArticlesFolder = row.path.startsWith(ARTICLE_FOLDER);
  return isArticleTemplate && isUnderArticlesFolder;
}

function buildItem(row) {
  const link = `${host}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || '');
  const pubDate = resolvePubDate(row);

  return `\t<item>
\t<title>${title}</title>
\t<description>${description}</description>
\t<link>${escapeXml(link)}</link>
\t<pubDate>${pubDate}</pubDate>
\t</item>`;
}

async function main() {
  const res = await fetch(`${host}/article-index.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch article-index.json: ${res.status} ${res.statusText}`);
  }
  const { data } = await res.json();

  const articleRows = data.filter(isArticle);
  const items = articleRows.map(buildItem).join('\n');
  const buildDate = toFeedDate();

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
 <title>AIG Stories/Articles</title>
 <description>This is feed of AIG Stories/Articles pages</description>
 <link>${escapeXml(host)}</link>
 <copyright>Copyright © ${new Date().getFullYear()} American International Group, Inc. All rights reserved.</copyright>
 <lastBuildDate>${buildDate}</lastBuildDate>
 <pubDate>${buildDate}</pubDate>
${items}
</channel>
</rss>
`;

  fs.writeFileSync(outputFile, xml);
  console.log(`Wrote ${articleRows.length} article entries to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
