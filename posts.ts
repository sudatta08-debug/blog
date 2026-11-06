import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export async function getPosts(): Promise<Post[]> {
  const all = await getCollection('posts', ({ data }) => import.meta.env.DEV || !data.draft);
  return all.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function plainText(md: string = ''): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(md: string = ''): number {
  const t = plainText(md);
  return t ? t.split(' ').length : 0;
}

export function readingTime(md: string = ''): number {
  return Math.max(1, Math.round(wordCount(md) / 220));
}

export function excerpt(post: Post, len = 160): string {
  if (post.data.description) return post.data.description;
  const t = plainText(post.body);
  return t.length > len ? t.slice(0, len).replace(/\s+\S*$/, '') + '…' : t;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function related(post: Post, all: Post[], n = 3): Post[] {
  const tags = new Set(post.data.tags);
  return all
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: p.data.tags.filter((t) => tags.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.data.pubDate.valueOf() - a.p.data.pubDate.valueOf())
    .slice(0, n)
    .map((x) => x.p);
}

export function allTags(posts: Post[]): { name: string; slug: string; count: number }[] {
  const map = new Map<string, { name: string; count: number }>();
  for (const p of posts)
    for (const t of p.data.tags) {
      const slug = slugify(t);
      const e = map.get(slug) || { name: t, count: 0 };
      e.count++;
      map.set(slug, e);
    }
  return [...map.entries()]
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ---------- SEO checks used by the admin SEO report ---------- */

export type Check = { label: string; ok: boolean; warn?: boolean; tip: string };

export function seoChecks(post: Post, all: Post[]): Check[] {
  const d = post.data;
  const title = d.seo?.title || d.title;
  const desc = d.seo?.description || d.description || '';
  const kw = (d.seo?.focusKeyword || '').toLowerCase().trim();
  const body = post.body || '';
  const text = plainText(body).toLowerCase();
  const words = wordCount(body);
  const firstPara = text.slice(0, 600);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const internal = (body.match(/\]\((\/|https?:\/\/[^)]*\/blog\/)[^)]*\)/g) || []).length;
  const imgs = body.match(/!\[([^\]]*)\]\([^)]*\)/g) || [];
  const imgsNoAlt = imgs.filter((m) => /^!\[\s*\]/.test(m)).length;
  const dupTitle = all.some((p) => p.id !== post.id && (p.data.seo?.title || p.data.title) === title);
  const kwCount = kw ? text.split(kw).length - 1 : 0;
  const density = kw && words ? (kwCount * kw.split(' ').length * 100) / words : 0;

  const checks: Check[] = [
    {
      label: 'Search title length',
      ok: title.length >= 30 && title.length <= 60,
      warn: title.length > 0 && (title.length < 30 || title.length > 60),
      tip: `${title.length} characters. Aim for 30–60 so Google shows it in full.`,
    },
    {
      label: 'Meta description',
      ok: desc.length >= 120 && desc.length <= 160,
      warn: desc.length > 0 && (desc.length < 120 || desc.length > 160),
      tip: desc.length
        ? `${desc.length} characters. Aim for 120–160.`
        : 'Missing. Write one or two sentences that make someone want to click.',
    },
    {
      label: 'Focus keyword set',
      ok: !!kw,
      tip: kw ? `“${kw}”` : 'Pick the phrase you want this post to rank for.',
    },
  ];

  if (kw) {
    checks.push(
      { label: 'Keyword in title', ok: title.toLowerCase().includes(kw), tip: 'Put the keyword near the start of the title.' },
      { label: 'Keyword in description', ok: desc.toLowerCase().includes(kw), tip: 'Use the keyword once in the meta description.' },
      { label: 'Keyword in opening', ok: firstPara.includes(kw), tip: 'Mention the keyword in the first paragraph.' },
      {
        label: 'Keyword in URL',
        ok: post.id.includes(slugify(kw)),
        warn: !post.id.includes(slugify(kw)),
        tip: `URL is /blog/${post.id}/. Short URLs with the keyword do best. Don’t change the URL of a post that already ranks.`,
      },
      {
        label: 'Keyword use',
        ok: density >= 0.5 && density <= 2.5,
        warn: true,
        tip: `Used ${kwCount} times (${density.toFixed(1)}%). About 0.5–2.5% reads naturally.`,
      }
    );
  }

  checks.push(
    {
      label: 'Length',
      ok: words >= 600,
      warn: words >= 300 && words < 600,
      tip: `${words} words. Posts over 600 words tend to rank better for competitive topics.`,
    },
    { label: 'Subheadings', ok: h2 >= 2, warn: h2 === 1, tip: `${h2} section headings (##). Break long posts into sections.` },
    { label: 'Links to your other posts', ok: internal >= 1, warn: true, tip: `${internal} internal links. Link to at least one related post.` },
    {
      label: 'Image alt text',
      ok: imgsNoAlt === 0 && (!d.cover || !!d.coverAlt),
      tip: imgsNoAlt || (d.cover && !d.coverAlt) ? 'Some images have no alt text. Describe each image in a few words.' : 'All images described.',
    },
    { label: 'Cover image', ok: !!d.cover, warn: true, tip: d.cover ? 'Set. Used when the post is shared.' : 'Add one so shares on WhatsApp and LinkedIn show a picture.' },
    { label: 'Tags', ok: d.tags.length >= 1 && d.tags.length <= 5, warn: true, tip: `${d.tags.length} tags. 1–5 is ideal.` },
    { label: 'Unique title', ok: !dupTitle, tip: dupTitle ? 'Another post has the same title.' : 'No other post uses this title.' },
    { label: 'Indexable', ok: !d.seo?.noindex && !d.draft, warn: true, tip: d.draft ? 'Draft: not published.' : d.seo?.noindex ? 'Hidden from search engines (noindex is on).' : 'Search engines can index this post.' }
  );
  return checks;
}

export function seoScore(checks: Check[]): number {
  const pts = checks.reduce((s, c) => s + (c.ok ? 1 : c.warn ? 0.5 : 0), 0);
  return Math.round((pts / checks.length) * 100);
}
