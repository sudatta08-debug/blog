import rss from '@astrojs/rss';
import settings from '../data/settings.json';
import { getPosts, excerpt } from '../lib/posts';

export async function GET(context) {
  const posts = (await getPosts()).filter((p) => !p.data.draft && !p.data.seo?.noindex);
  return rss({
    title: settings.siteTitle,
    description: settings.siteDescription,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: excerpt(p),
      pubDate: p.data.pubDate,
      link: `/blog/${p.id}/`,
      categories: p.data.tags,
    })),
    customData: `<language>${settings.language}</language>`,
  });
}
