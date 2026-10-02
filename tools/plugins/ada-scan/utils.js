function getOpts(token, method = 'GET') {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

async function fetchDoc(path, token) {
  const opts = getOpts(token);
  const srcPath = path.endsWith('.html') ? path : `${path}.html`;
  const resp = await fetch(`https://admin.da.live/source${srcPath}`, opts);
  if (!resp.ok) return { message: 'Could not fetch doc.', status: resp.status };
  const html = await resp.text();
  return { html };
}

const VAGUE_LINK_TEXT = ['click here', 'here', 'read more', 'more', 'link', 'this page'];

function checkImages(doc) {
  return [...doc.querySelectorAll('img')].reduce((issues, img) => {
    if (!img.hasAttribute('alt')) {
      issues.push({ rule: 'image-alt', message: 'Image missing "alt" attribute' });
    }
    return issues;
  }, []);
}

function checkLinks(doc) {
  return [...doc.querySelectorAll('a[href]')].reduce((issues, link) => {
    const text = (link.textContent || '').trim().toLowerCase();
    const label = link.getAttribute('aria-label');
    if (!text && !label) {
      issues.push({ rule: 'link-name', message: 'Link has no accessible text' });
    } else if (!label && VAGUE_LINK_TEXT.includes(text)) {
      issues.push({ rule: 'link-name', message: `Link text is not descriptive ("${text}")` });
    }
    return issues;
  }, []);
}

function checkHeadings(doc) {
  const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const issues = [];

  headings.forEach((heading) => {
    if (!heading.textContent.trim()) {
      issues.push({ rule: 'empty-heading', message: `Empty <${heading.tagName.toLowerCase()}> heading` });
    }
  });

  let prevLevel = 0;
  headings.forEach((heading) => {
    const level = Number(heading.tagName[1]);
    if (prevLevel && level - prevLevel > 1) {
      issues.push({ rule: 'heading-order', message: `Heading level skips from h${prevLevel} to h${level}` });
    }
    prevLevel = level;
  });

  return issues;
}

function checkTables(doc) {
  return [...doc.querySelectorAll('table')].reduce((issues, table) => {
    if (!table.querySelector('th')) {
      issues.push({ rule: 'table-headers', message: 'Table has no header (<th>) cells' });
    }
    return issues;
  }, []);
}

export async function scanAccessibility(path, token) {
  const { html, message, status } = await fetchDoc(path, token);
  if (!html) return { message: message || 'Could not fetch doc.', status, issues: undefined };

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const issues = [
    ...checkImages(doc),
    ...checkLinks(doc),
    ...checkHeadings(doc),
    ...checkTables(doc),
  ];

  return { issues };
}
