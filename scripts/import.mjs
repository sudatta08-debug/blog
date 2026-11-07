#!/usr/bin/env node
/**
 * Import posts from Blogger/Blogspot backups and WordPress exports, merged into one blog.
 *
 *   npm run import -- blogger-backup.xml wordpress-export.xml [--download-images] [--include-drafts] [--overwrite]
 *
 * - Blogger: Settings > Manage blog > Back up content (.xml)
 * - WordPress: Tools > Export > Export all (unzip it first; use the .xml inside)
 *
 * What it does
 *  - Converts every published post into Markdown in src/content/posts/
 *  - Merges duplicates (same title on both sites): keeps the earliest publish date, the longest
 *    version of the text, and every topic from both copies
 *  - Keeps Blogger's URL names where possible, e.g. /2023/05/my-post.html -> /blog/my-post/
 *  - Writes public/_redirects and blogger-redirect-snippet.html (for your Blogger theme)
 *  - With --download-images, saves images into public/uploads/imported/ and rewrites links
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const DOWNLOAD = args.includes('--download-images');
const DRAFTS = args.includes('--include-drafts');
const OVERWRITE = args.includes('--overwrite');

if (!files.length || files.some((f) => !existsSync(f))) {
  console.error('Usage: npm run import -- file1.xml [file2.xml] [--download-images] [--include-drafts] [--overwrite]');
  for (const f of files) if (!existsSync(f)) console.error(`  not found: ${f}`);
  process.exit(1);
}

const settings = JSON.parse(readFileSync('src/data/settings.json', 'utf8'));
const NEW_SITE = (process.env.SITE_URL || settings.siteUrl).replace(/\/$/, '');
const POSTS_DIR = 'src/content/posts';
const IMG_DIR = 'public/uploads/imported';
mkdirSync(POSTS_DIR, { recursive: true });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  isArray: (name) => ['entry', 'category', 'link', 'item'].includes(name),
  processEntities: true,
  htmlEntities: true,
});
const text = (v) => (v == null ? '' : typeof v === 'object' ? v['#text'] ?? '' : String(v));
const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const titleKey = (t) => slugify(t.split('|')[0]).replace(/-+/g, '');
const wordsOf = (html) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

/* ---------- Blogger ---------- */
const KIND = 'http://schemas.google.com/g/2005#kind';
function readBlogger(feed) {
  const host = (feed.link || []).find((l) => l['@rel'] === 'alternate')?.['@href'];
  const origin = host ? new URL(host).origin : '';
  const out = [];
  for (const e of feed.entry || []) {
    const type = text(e['blogger:type']);
    const isPost = type
      ? type.toUpperCase() === 'POST'
      : (e.category || []).some((c) => c['@scheme'] === KIND && String(c['@term']).endsWith('#post'));
    if (!isPost) continue;
    const status = text(e['blogger:status']);
    const draft = status ? status.toUpperCase() !== 'LIVE' : text(e['app:control']?.['app:draft']).toLowerCase() === 'yes';
    let path = text(e['blogger:filename']);
    if (!path) {
      const alt = (e.link || []).find((l) => l['@rel'] === 'alternate')?.['@href'];
      if (alt) path = new URL(alt).pathname;
    }
    if (path && !path.startsWith('/')) path = '/' + path;
    out.push({
      source: 'Blogger',
      title: text(e.title).trim() || 'Untitled',
      html: text(e.content),
      date: new Date(text(e.published) || text(e.updated)),
      updated: new Date(text(e.updated) || text(e.published)),
      tags: (e.category || [])
        .filter((c) => c['@scheme'] !== KIND && c['@term'] && !String(c['@term']).startsWith('http'))
        .map((c) => String(c['@term']).trim()),
      draft,
      description: text(e['blogger:metaDescription'] || e['blogger:searchDescription']).trim(),
      slug: path ? slugify(path.split('/').pop().replace(/\.html?$/, '')) : '',
      bloggerPath: path,
      oldUrls: path ? [origin ? origin + path : path] : [],
    });
  }
  return out;
}

/* ---------- WordPress (WXR) ---------- */
function autop(html) {
  // Classic-editor WordPress content has no <p> tags; blank lines mean new paragraphs.
  if (/<!-- wp:|<p[\s>]/i.test(html)) return html;
  return html
    .split(/\n\s*\n/)
    .map((b) => (/^\s*<(h\d|ul|ol|blockquote|table|figure|div|pre|img)/i.test(b) ? b : `<p>${b.replace(/\n/g, '<br>')}</p>`))
    .join('\n');
}
function readWordPress(channel) {
  const out = [];
  for (const it of channel.item || []) {
    if (text(it['wp:post_type']) !== 'post') continue;
    const status = text(it['wp:status']);
    if (status === 'trash' || status === 'auto-draft') continue;
    const cats = it.category || [];
    const tags = cats
      .map((c) => ({ d: c['@domain'], n: text(c).trim() }))
      .filter((c) => (c.d === 'category' || c.d === 'post_tag') && c.n && c.n.toLowerCase() !== 'uncategorized')
      .map((c) => c.n);
    const link = text(Array.isArray(it.link) ? it.link[0] : it.link);
    const dateStr = text(it['wp:post_date_gmt']) && !text(it['wp:post_date_gmt']).startsWith('0000') ? text(it['wp:post_date_gmt']) + 'Z' : text(it['wp:post_date']);
    const modStr = text(it['wp:post_modified_gmt']) ? text(it['wp:post_modified_gmt']) + 'Z' : dateStr;
    out.push({
      source: 'WordPress',
      title: text(it.title).trim() || 'Untitled',
      html: autop(text(it['content:encoded'])),
      date: new Date(dateStr.replace(' ', 'T')),
      updated: new Date(modStr.replace(' ', 'T')),
      tags,
      draft: status !== 'publish',
      description: text(it['excerpt:encoded']).replace(/<[^>]+>/g, '').trim(),
      slug: /^example-post|^\d+$/.test(text(it['wp:post_name'])) ? '' : slugify(text(it['wp:post_name'])),
      bloggerPath: '',
      oldUrls: link ? [link] : [],
    });
  }
  return out;
}

/* ---------- read all files ---------- */
let raw = [];
for (const f of files) {
  const xml = parser.parse(readFileSync(f, 'utf8'));
  if (xml.feed) raw.push(...readBlogger(xml.feed));
  else if (xml.rss?.channel) raw.push(...readWordPress(Array.isArray(xml.rss.channel) ? xml.rss.channel[0] : xml.rss.channel));
  else {
    console.error(`${f}: not a Blogger backup or WordPress export.`);
    process.exit(1);
  }
  console.log(`Read ${f}`);
}
const skippedDrafts = raw.filter((p) => p.draft && !DRAFTS).length;
raw = raw.filter((p) => DRAFTS || !p.draft);

/* ---------- merge duplicates ---------- */
const groups = new Map();
for (const p of raw) {
  const k = titleKey(p.title);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}
const posts = [...groups.values()].map((g) => {
  const longest = [...g].sort((a, b) => wordsOf(b.html) - wordsOf(a.html))[0];
  const earliest = [...g].sort((a, b) => a.date - b.date)[0];
  const latest = [...g].sort((a, b) => b.updated - a.updated)[0];
  const blogger = g.find((p) => p.source === 'Blogger');
  const tagMap = new Map();
  for (const p of g) for (const t of p.tags) if (!tagMap.has(slugify(t))) tagMap.set(slugify(t), t);
  return {
    ...longest,
    title: (blogger || longest).title,
    date: earliest.date,
    updated: latest.updated,
    tags: [...tagMap.values()],
    description: g.map((p) => p.description).find(Boolean) || '',
    slug: g.map((p) => p.slug).find(Boolean) || slugify(longest.title),
    bloggerPath: blogger?.bloggerPath || '',
    oldUrls: g.flatMap((p) => p.oldUrls),
    sources: [...new Set(g.map((p) => p.source))],
  };
});

/* ---------- html -> markdown ---------- */
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' });
td.use(gfm);
td.keep(['iframe', 'video', 'audio']);
td.remove(['script', 'style', 'noscript']);
td.addRule('linkedImage', {
  filter: (node) => node.nodeName === 'A' && node.childNodes.length === 1 && node.firstChild.nodeName === 'IMG',
  replacement: (_c, node) => {
    const img = node.firstChild;
    const alt = (img.getAttribute('alt') || img.getAttribute('title') || '').replace(/[\[\]]/g, '');
    return `![${alt}](${img.getAttribute('src')})`;
  },
});
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
td.addRule('figure', {
  filter: 'figure',
  replacement: (content, node) => {
    const img = node.querySelector('img');
    const cap = node.querySelector('figcaption');
    if (!img) return content;
    const alt = (img.getAttribute('alt') || (cap && cap.textContent) || '').trim().replace(/[\[\]]/g, '');
    return `\n\n![${alt}](${img.getAttribute('src')})\n${cap && cap.textContent.trim() ? `\n_${cap.textContent.trim()}_\n` : ''}\n`;
  },
});

function toMarkdown(html) {
  const h = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div[^>]*class="separator"[^>]*>/gi, '<p>')
    .replace(/<div[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '')
    .replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>')
    .replace(/<span[^>]*>|<\/span>/gi, '')
    .replace(/&nbsp;| /g, ' ')
    .replace(/<a name="more"><\/a>/gi, '');
  let md = td.turndown(h)
    .replace(/^# /gm, '## ')
    .replace(/^[ \t]+$/gm, '')                                  // whitespace-only lines
    .replace(/[ \t]+$/gm, '')                                   // trailing spaces
    .replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, '$1$2 ')              // "-   item" -> "- item"
    .replace(/^(#{2,4} .*?)\*\*(.+?)\*\*(.*)$/gm, '$1$2$3')        // no bold inside headings
    .replace(/^(#{2,4} .*?)\s*[-–:]\s*$/gm, '$1');               // trailing dash in headings
  // tighten loose lists (blank line between consecutive items)
  md = md.replace(/^([-*] .*)\n\n(?=[-*] )/gm, '$1\n').replace(/^(\d+\. .*)\n\n(?=\d+\. )/gm, '$1\n');
  md = md.replace(/^([-*] .*)\n\n(?=[-*] )/gm, '$1\n');
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- images ---------- */
function biggerImage(url) {
  return url
    .replace(/(googleusercontent\.com|bp\.blogspot\.com)(.*?)\/(?:s\d{2,4}|w\d{2,4}-h\d{2,4})(?:-[a-z0-9-]+)?\//, '$1$2/s1600/')
    .replace(/(files\.wordpress\.com|wp\.com)(\/[^?]+)\?[^)\s]*/, '$1$2?w=1600');
}
const imgCache = new Map();
async function localImage(url) {
  if (!DOWNLOAD || !/^https?:\/\//.test(url)) return url;
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    const ext = type.includes('png') ? '.png' : type.includes('gif') ? '.gif' : type.includes('webp') ? '.webp' : extname(new URL(url).pathname).toLowerCase() || '.jpg';
    mkdirSync(IMG_DIR, { recursive: true });
    const base = slugify(decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, ''))) || 'image';
    let name = base + ext, i = 1;
    while (existsSync(join(IMG_DIR, name))) name = `${base}-${i++}${ext}`;
    writeFileSync(join(IMG_DIR, name), buf);
    const local = `/uploads/imported/${name}`;
    imgCache.set(url, local);
    return local;
  } catch (err) {
    console.warn(`  could not download ${url} (${err.message}); keeping the original link`);
    imgCache.set(url, url);
    return url;
  }
}
async function fixImages(md) {
  md = md.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => `![${alt}](${biggerImage(src)})`);
  const urls = [...new Set([...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]))];
  for (const u of urls) md = md.split(u).join(await localImage(u));
  return md;
}

/* ---------- write ---------- */
const y = (s) => JSON.stringify(s ?? '');
const day = (d) => (isNaN(d) ? new Date() : d).toISOString().slice(0, 10);
const used = new Set();
const redirects = [];
const map = {};
let written = 0, skipped = 0;

posts.sort((a, b) => a.date - b.date);
for (const p of posts) {
  let slug = p.slug || `post-${written + 1}`, n = 2;
  while (used.has(slug)) slug = `${p.slug}-${n++}`;
  used.add(slug);

  const out = join(POSTS_DIR, `${slug}.md`);
  if (existsSync(out) && !OVERWRITE) { skipped++; continue; }

  let body = await fixImages(toMarkdown(p.html));
  const firstImg = body.match(/!\[([^\]]*)\]\(([^)\s]+)\)/);
  // The first image becomes the cover (shown above the post), so remove it from the text
  // if it appears near the top, to avoid showing it twice.
  if (firstImg && body.indexOf(firstImg[0]) < 1500) {
    body = body.replace(firstImg[0], '').replace(/\n{3,}/g, '\n\n');
  }

  const fm = [
    '---',
    `title: ${y(p.title)}`,
    `description: ${y(p.description)}`,
    `pubDate: ${day(p.date)}`,
    p.updated - p.date > 7 * 86400000 ? `updatedDate: ${day(p.updated)}` : null,
    p.tags.length ? `tags:\n${p.tags.map((t) => `  - ${y(t)}`).join('\n')}` : 'tags: []',
    firstImg ? `cover: ${y(firstImg[2])}` : null,
    firstImg ? `coverAlt: ${y(firstImg[1] || p.title)}` : null,
    `draft: ${p.draft}`,
    p.oldUrls.length ? `bloggerUrl: ${y(p.oldUrls[0])}` : null,
    'seo:',
    `  description: ${y(p.description)}`,
    '  focusKeyword: ""',
    '  noindex: false',
    '---',
    '',
  ].filter((l) => l !== null).join('\n');

  writeFileSync(out, fm + body.trim() + '\n');
  written++;
  for (const u of p.oldUrls) {
    try {
      const path = new URL(u, 'https://x.invalid').pathname;
      if (!p.draft && path !== '/') {
        redirects.push(`${path}  /blog/${slug}/  301`);
        if (u.includes('blogspot.com') || p.bloggerPath === path) map[path] = `/blog/${slug}/`;
      }
    } catch {}
  }
  console.log(`  ✓ ${slug}  (${p.sources.join(' + ')}, ${day(p.date)})`);
}

/* ---------- redirects ---------- */
if (redirects.length) {
  const labels = new Set(raw.filter((p) => p.source === 'Blogger').flatMap((p) => p.tags));
  const lines = [
    '# Old Blogger/WordPress addresses -> new posts (generated by scripts/import.mjs)',
    ...new Set(redirects),
    ...[...labels].map((l) => `/search/label/${encodeURIComponent(l)}  /tags/${slugify(l)}/  301`),
    '/search/label/*  /tags/  301',
    '/feeds/posts/default  /rss.xml  301',
    '/feed/  /rss.xml  301',
    '/p/about.html  /about/  301',
    '',
  ];
  const existing = existsSync('public/_redirects') ? readFileSync('public/_redirects', 'utf8') : '';
  const kept = existing.split('# Old Blogger')[0].trimEnd();
  writeFileSync('public/_redirects', (kept ? kept + '\n\n' : '') + lines.join('\n'));

  if (Object.keys(map).length) {
    writeFileSync(
      'blogger-redirect-snippet.html',
      `<!-- Paste this right after <head> in Blogger: Theme > Customise (down arrow) > Edit HTML -->
<script>
//<![CDATA[
(function () {
  var site = ${JSON.stringify(NEW_SITE)};
  var map = ${JSON.stringify(map, null, 2)};
  var p = location.pathname, target = map[p];
  if (!target && p.indexOf('/search/label/') === 0) target = '/tags/' + decodeURIComponent(p.split('/').pop()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '/';
  if (!target && (p === '/' || p === '')) target = '/';
  if (target) {
    var l = document.createElement('link'); l.rel = 'canonical'; l.href = site + target; document.head.appendChild(l);
    location.replace(site + target);
  }
})();
//]]>
</script>
`
    );
  }
}

console.log(`\nImported ${written} posts (${raw.length} found, ${raw.length - posts.length} duplicates merged).`);
if (skipped) console.log(`Skipped ${skipped} that already exist (add --overwrite to replace them).`);
if (skippedDrafts) console.log(`Left out ${skippedDrafts} drafts (add --include-drafts to import them as drafts).`);
if (redirects.length) console.log('Wrote public/_redirects' + (Object.keys(map).length ? ' and blogger-redirect-snippet.html.' : '.'));
if (!DOWNLOAD) console.log('Images still load from the old sites. Run again with --download-images --overwrite to copy them here.');
