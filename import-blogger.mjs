#!/usr/bin/env node
/**
 * Import posts from a Blogger / Blogspot backup file.
 *
 *   npm run import:blogger -- path/to/blog-backup.xml [--download-images] [--include-drafts]
 *
 * What it does
 *  - Converts every published post into a Markdown file in src/content/posts/
 *  - Keeps the same URL slug Blogger used (e.g. /2023/05/my-post.html -> /blog/my-post/)
 *  - Copies labels as topics, dates, search description and the first image as cover
 *  - Writes public/_redirects so old Blogger paths go to the new posts (for when you move a custom domain)
 *  - Writes blogger-redirect-snippet.html to paste into your Blogger theme so old blogspot.com
 *    links send readers (and Google) to the new site
 *  - With --download-images, saves images into public/uploads/blogger/ and rewrites links
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const DOWNLOAD = args.includes('--download-images');
const DRAFTS = args.includes('--include-drafts');
const OVERWRITE = args.includes('--overwrite');

if (!file || !existsSync(file)) {
  console.error('Usage: npm run import:blogger -- path/to/blog-backup.xml [--download-images] [--include-drafts] [--overwrite]');
  process.exit(1);
}

const settings = JSON.parse(readFileSync('src/data/settings.json', 'utf8'));
const NEW_SITE = (process.env.SITE_URL || settings.siteUrl).replace(/\/$/, '');
const POSTS_DIR = 'src/content/posts';
const IMG_DIR = 'public/uploads/blogger';
mkdirSync(POSTS_DIR, { recursive: true });

/* ---------- parse ---------- */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  isArray: (name) => ['entry', 'category', 'link'].includes(name),
  processEntities: true,
  htmlEntities: true,
});
const xml = parser.parse(readFileSync(file, 'utf8'));
const feed = xml.feed;
if (!feed) {
  console.error('This does not look like a Blogger backup (no <feed> element).');
  process.exit(1);
}
const entries = feed.entry || [];
const text = (v) => (v == null ? '' : typeof v === 'object' ? v['#text'] ?? '' : String(v));

const KIND = 'http://schemas.google.com/g/2005#kind';
const blogHost = (() => {
  for (const l of feed.link || []) if (l['@rel'] === 'alternate' && l['@href']) return new URL(l['@href']).origin;
  return '';
})();

function isPost(e) {
  // New export format (2023+)
  const t = text(e['blogger:type']);
  if (t) return t.toUpperCase() === 'POST';
  // Classic format
  return (e.category || []).some((c) => c['@scheme'] === KIND && String(c['@term']).endsWith('#post'));
}
function isDraft(e) {
  const s = text(e['blogger:status']);
  if (s) return s.toUpperCase() !== 'LIVE';
  const d = e['app:control']?.['app:draft'];
  return text(d).toLowerCase() === 'yes';
}
function labels(e) {
  return (e.category || [])
    .filter((c) => c['@scheme'] !== KIND && c['@term'] && !String(c['@term']).startsWith('http'))
    .map((c) => String(c['@term']).trim())
    .filter(Boolean);
}
function oldPath(e) {
  const fn = text(e['blogger:filename']);
  if (fn) return fn.startsWith('/') ? fn : '/' + fn;
  for (const l of e.link || []) if (l['@rel'] === 'alternate' && l['@href']) return new URL(l['@href']).pathname;
  return '';
}
function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/* ---------- html -> markdown ---------- */
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' });
td.use(gfm);
td.keep(['iframe', 'video', 'audio']);
td.remove(['script', 'style', 'noscript']);
// Blogger wraps images in links to the full-size version; keep just the image.
td.addRule('linkedImage', {
  filter: (node) => node.nodeName === 'A' && node.childNodes.length === 1 && node.firstChild.nodeName === 'IMG',
  replacement: (_c, node) => {
    const img = node.firstChild;
    const alt = (img.getAttribute('alt') || img.getAttribute('title') || '').replace(/[\[\]]/g, '');
    return `![${alt}](${img.getAttribute('src')})`;
  },
});
// Blogger image captions are tables with class tr-caption-container
td.addRule('captionTable', {
  filter: (node) => node.nodeName === 'TABLE' && /tr-caption-container/.test(node.getAttribute('class') || ''),
  replacement: (_c, node) => {
    const img = node.querySelector('img');
    const cap = node.querySelector('.tr-caption');
    if (!img) return '';
    const alt = (img.getAttribute('alt') || (cap && cap.textContent) || '').trim().replace(/[\[\]]/g, '');
    return `\n\n![${alt}](${img.getAttribute('src')})\n${cap ? `\n_${cap.textContent.trim()}_\n` : ''}\n`;
  },
});

function toMarkdown(html) {
  // Blogger often uses <br> or divs instead of paragraphs
  let h = html
    .replace(/<div[^>]*class="separator"[^>]*>/gi, '<p>')
    .replace(/<div[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '')
    .replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>')
    .replace(/<span[^>]*>|<\/span>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<a name="more"><\/a>|<!--more-->/gi, '');
  let md = td.turndown(h);
  // Blogger posts usually start headings at h2/h3; make sure the post has no h1
  md = md.replace(/^# /gm, '## ');
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- images ---------- */
const imgCache = new Map();
async function localImage(url) {
  if (!DOWNLOAD || !/^https?:\/\//.test(url)) return url;
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    // Ask Blogger for a sensible size (1600px wide) instead of the original
    const fetchUrl = url.replace(/\/s\d+(-[a-z0-9-]+)?\//, '/s1600/').replace(/=s\d+(-[a-z0-9-]+)?$/, '=s1600');
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    const ext = type.includes('png') ? '.png' : type.includes('gif') ? '.gif' : type.includes('webp') ? '.webp' : extname(new URL(url).pathname).toLowerCase() || '.jpg';
    mkdirSync(IMG_DIR, { recursive: true });
    const base = slugify(decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, ''))) || 'image';
    let name = base + ext, i = 1;
    while (existsSync(join(IMG_DIR, name))) name = `${base}-${i++}${ext}`;
    writeFileSync(join(IMG_DIR, name), buf);
    const local = `/uploads/blogger/${name}`;
    imgCache.set(url, local);
    return local;
  } catch (err) {
    console.warn(`  could not download ${url} (${err.message}); keeping the original link`);
    imgCache.set(url, url);
    return url;
  }
}
async function rewriteImages(md) {
  // Blogger serves thumbnails (s320, s400…) inside posts; ask for a larger size instead
  md = md.replace(/(https?:\/\/[^)\s]*(?:googleusercontent\.com|bp\.blogspot\.com)[^)\s]*?)\/s\d{2,4}(?:-[a-z0-9-]+)?\//g, '$1/s1600/');
  const urls = [...new Set([...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]))];
  for (const u of urls) md = md.split(u).join(await localImage(u));
  return md;
}

/* ---------- write ---------- */
const y = (s) => JSON.stringify(s ?? ''); // JSON strings are valid YAML
const used = new Set();
const redirects = [];
const map = {};
let written = 0, skipped = 0, drafts = 0;

for (const e of entries) {
  if (!isPost(e)) continue;
  const draft = isDraft(e);
  if (draft && !DRAFTS) { drafts++; continue; }

  const title = text(e.title).trim() || 'Untitled';
  const html = text(e.content);
  const path = oldPath(e);
  let slug = path ? slugify(path.split('/').pop().replace(/\.html?$/, '')) : '';
  if (!slug) slug = slugify(title) || `post-${written + 1}`;
  let s = slug, n = 2;
  while (used.has(s)) s = `${slug}-${n++}`;
  slug = s;
  used.add(slug);

  const out = join(POSTS_DIR, `${slug}.md`);
  if (existsSync(out) && !OVERWRITE) { skipped++; continue; }

  const published = new Date(text(e.published) || text(e.updated) || Date.now());
  const updated = new Date(text(e.updated) || published);
  const tags = labels(e);
  const metaDesc = text(e['blogger:metaDescription'] || e['blogger:searchDescription'] || '').trim();
  let body = await rewriteImages(toMarkdown(html));
  const firstImg = body.match(/!\[([^\]]*)\]\(([^)\s]+)/);
  const oldUrl = path ? (blogHost ? blogHost + path : path) : '';

  const fm = [
    '---',
    `title: ${y(title)}`,
    `description: ${y(metaDesc)}`,
    `pubDate: ${published.toISOString().slice(0, 10)}`,
    updated - published > 86400000 ? `updatedDate: ${updated.toISOString().slice(0, 10)}` : null,
    tags.length ? `tags:\n${tags.map((t) => `  - ${y(t)}`).join('\n')}` : 'tags: []',
    firstImg ? `cover: ${y(firstImg[2])}` : null,
    firstImg ? `coverAlt: ${y(firstImg[1] || title)}` : null,
    `draft: ${draft}`,
    oldUrl ? `bloggerUrl: ${y(oldUrl)}` : null,
    'seo:',
    `  description: ${y(metaDesc)}`,
    '  focusKeyword: ""',
    '  noindex: false',
    '---',
    '',
  ].filter((l) => l !== null).join('\n');

  // Avoid showing the cover image twice: drop it from the top of the body
  if (firstImg && body.trimStart().startsWith(firstImg[0])) {
    body = body.replace(/^\s*!\[[^\]]*\]\([^)]*\)\s*(\n_[^\n]*_\n)?/, '');
  }

  writeFileSync(out, fm + body.trim() + '\n');
  written++;
  if (path && !draft) {
    redirects.push(`${path}  /blog/${slug}/  301`);
    map[path] = `/blog/${slug}/`;
  }
  console.log(`  ✓ ${slug}`);
}

/* ---------- redirects ---------- */
if (redirects.length) {
  const allLabels = new Set();
  for (const e of entries) if (isPost(e)) labels(e).forEach((l) => allLabels.add(l));
  const lines = [
    '# Old Blogger addresses -> new posts (generated by scripts/import-blogger.mjs)',
    ...redirects,
    ...[...allLabels].map((l) => `/search/label/${encodeURIComponent(l).replace(/%20/g, '%20')}  /tags/${slugify(l)}/  301`),
    '/search/label/*  /tags/  301',
    '/feeds/posts/default  /rss.xml  301',
    '/p/about.html  /about/  301',
    '',
  ];
  const existing = existsSync('public/_redirects') ? readFileSync('public/_redirects', 'utf8') : '';
  const kept = existing.split('# Old Blogger addresses')[0].trimEnd();
  writeFileSync('public/_redirects', (kept ? kept + '\n\n' : '') + lines.join('\n'));

  // Snippet for the Blogger theme: send visitors and Google to the new address
  const snippet = `<!-- Paste this right after <head> in Blogger: Theme > Customise (down arrow) > Edit HTML -->
<b:if cond='data:view.isPost or data:view.isHomepage or data:view.isLabelSearch'>
<script>
//<![CDATA[
(function () {
  var site = ${JSON.stringify(NEW_SITE)};
  var map = ${JSON.stringify(map)};
  var p = location.pathname;
  var target = map[p];
  if (!target && p.indexOf('/search/label/') === 0) target = '/tags/' + decodeURIComponent(p.split('/').pop()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '/';
  if (!target && (p === '/' || p === '')) target = '/';
  if (target) {
    var l = document.createElement('link'); l.rel = 'canonical'; l.href = site + target; document.head.appendChild(l);
    location.replace(site + target);
  }
})();
//]]>
</script>
</b:if>
`;
  writeFileSync('blogger-redirect-snippet.html', snippet);
}

console.log(`\nImported ${written} posts into ${POSTS_DIR}.`);
if (skipped) console.log(`Skipped ${skipped} that already exist (add --overwrite to replace them).`);
if (drafts) console.log(`Left out ${drafts} drafts (add --include-drafts to import them as drafts).`);
if (redirects.length) console.log('Wrote public/_redirects and blogger-redirect-snippet.html.');
if (!DOWNLOAD) console.log('Images still load from Blogger. Run again with --download-images --overwrite to copy them here.');
