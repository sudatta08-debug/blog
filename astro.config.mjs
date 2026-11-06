import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync, readdirSync } from 'node:fs';

const settings = JSON.parse(readFileSync('./src/data/settings.json', 'utf8'));

// Keep posts marked "noindex" or "draft" out of the sitemap.
const hidden = new Set();
for (const file of readdirSync('./src/content/posts')) {
  if (!file.endsWith('.md')) continue;
  const text = readFileSync(`./src/content/posts/${file}`, 'utf8');
  const fm = text.split('---')[1] || '';
  if (/^\s*noindex:\s*true/m.test(fm) || /^draft:\s*true/m.test(fm)) {
    hidden.add(file.replace(/\.md$/, ''));
  }
}

export default defineConfig({
  site: process.env.SITE_URL || settings.siteUrl,
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        if (path.startsWith('/admin')) return false;
        const m = path.match(/^\/blog\/([^/]+)\/$/);
        return !(m && hidden.has(m[1]));
      },
    }),
  ],
  markdown: {
    shikiConfig: { theme: 'github-light' },
  },
});
