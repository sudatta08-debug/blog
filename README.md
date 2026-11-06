# Sudatta Das: blog

A fast, free blog with an admin panel and built-in SEO tools.

- **Site**: built with [Astro](https://astro.build). Every page is plain HTML, so it loads fast and Google can read it easily.
- **Admin panel**: [Sveltia CMS](https://sveltiacms.app) at `/admin/`. Write, edit, schedule drafts, upload images, change site settings.
- **Hosting**: Netlify's free plan. Your posts live in your own GitHub repository, so you always own a copy.
- **Cost**: ₹0. A custom domain (optional) is the only thing you'd ever pay for.

---

## What's included

**For readers**
- Clean reading layout with a progress bar, table of contents on longer posts, related posts and share buttons (WhatsApp, LinkedIn, X, copy link)
- Posts grouped by year on the home page, a "Start here" featured post, topic pages, About page
- Works on phones, keyboard-friendly, respects "reduce motion"

**SEO (search engine optimisation)**
- Per-post SEO fields in the admin: focus keyword, search title, meta description, social share image, canonical URL, hide from Google
- Live character counters on the search title (30–60) and description (120–160)
- **SEO report at `/admin/seo/`**: scores every post out of 100 and lists what to fix (title and description length, keyword placement, length, headings, internal links, image alt text, cover image, duplicates)
- Automatic sitemap (`/sitemap-index.xml`), `robots.txt`, RSS feed (`/rss.xml`)
- Structured data Google uses for rich results: `BlogPosting`, `BreadcrumbList`, `WebSite`, `ProfilePage`
- Open Graph and X cards so links show a title, description and picture when shared
- Canonical URLs, clean URLs (`/blog/post-name/`), `noindex` on admin pages
- Google Search Console, Bing and Google Analytics: paste the codes in **Site settings**, no code changes needed
- Uploaded photos are converted to WebP and resized automatically (faster pages rank better)

**Blogspot migration**
- `scripts/import-blogger.mjs` converts your Blogger backup into posts here, keeping titles, dates, labels (as topics), search descriptions and images
- Keeps your old URL names, so `/2024/03/my-post.html` becomes `/blog/my-post/`
- Creates redirects and a snippet for your Blogger theme so old links and Google rankings move to the new site

---

## Setting it up (about 30 minutes, one time)

### 1. Put the code on GitHub
1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Click **+ → New repository**. Name it, for example, `blog`. Keep it **Public** or **Private** (both work). Click **Create repository**.
3. On the next page click **uploading an existing file**, drag in everything from this folder (not the folder itself, its contents), and click **Commit changes**.

### 2. Tell the admin panel where your repository is
In GitHub, open `public/admin/config.yml`, click the pencil icon, and change this line to your username and repository name:

```yaml
repo: YOUR-GITHUB-USERNAME/YOUR-REPO-NAME
```

Commit the change.

### 3. Publish on Netlify
1. Sign up at [netlify.com](https://www.netlify.com) using **Sign up with GitHub**.
2. Click **Add new project → Import an existing project → GitHub**, pick your repository, and click **Deploy**. The build settings are already in `netlify.toml`.
3. When it finishes, go to **Project configuration → Change project name** and pick a name, e.g. `sudatta-blog`. Your site is now at `https://sudatta-blog.netlify.app`.
4. If you chose a different name, update `siteUrl` in `src/data/settings.json` and `site_url` / `display_url` in `public/admin/config.yml` to match.

### 4. Turn on the admin login
1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Application name: `My blog admin`
   - Homepage URL: `https://sudatta-blog.netlify.app`
   - Authorization callback URL: `https://api.netlify.com/auth/done`
   - Click **Register**, then **Generate a new client secret**. Keep the page open.
2. On Netlify: **Project configuration → Security → OAuth → Install provider → GitHub**. Paste the Client ID and Client secret. Save.
3. Visit `https://sudatta-blog.netlify.app/admin/` and click **Sign in with GitHub**.

That's it. Every time you press **Publish** in the admin, Netlify rebuilds the site and the change is live in about a minute.

---

## Moving your Blogspot posts

1. In Blogger: **Settings → Manage blog → Back up content → Download**. You get an `.xml` file.
2. Either send that file to Claude to run the import for you, or run it yourself (needs [Node.js 22+](https://nodejs.org)):
   ```bash
   npm install
   npm run import:blogger -- path/to/blog-backup.xml --download-images
   ```
   Options: `--download-images` copies images into the site (recommended, so they don't depend on Blogger), `--include-drafts` imports drafts too, `--overwrite` replaces posts already imported.
3. Upload the new files in `src/content/posts/`, `public/uploads/blogger/` and `public/_redirects` to GitHub.
4. **Send old readers and Google to the new site.** Open `blogger-redirect-snippet.html` (created by the import). In Blogger go to **Theme → (down arrow next to Customise) → Edit HTML**, paste the snippet right after `<head>`, and save. Anyone opening an old blogspot.com post now lands on the same post here.
5. **Keep the Blogspot blog online.** Don't delete it; the redirects only work while it exists.

Blogger comments are not imported.

---

## Getting found on Google

1. Go to [Google Search Console](https://search.google.com/search-console) → **Add property → URL prefix** → enter your site address.
2. Choose **HTML tag**, copy only the code inside `content="…"`, paste it into **Admin → Site settings → Google Search Console code**, and publish. Back in Search Console, click **Verify**.
3. In Search Console open **Sitemaps** and submit `sitemap-index.xml`.
4. Optional: do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters) (you can import from Google in one click).
5. Check `/admin/seo/` after writing each post and fix anything marked ❌.

Writing tips the report checks for:
- One focus keyword per post, the way a reader would type it into Google.
- Use it in the title, the first paragraph and the meta description.
- Break the post into sections with **Heading 2**.
- Link to at least one of your other posts.
- Describe every image (alt text).
- Don't change the URL of a post that's already getting traffic.

---

## Adding your own domain later
Buy a domain from any registrar (Namecheap, GoDaddy, Hostinger and so on), then in Netlify go to **Domain management → Add a domain** and follow the steps. HTTPS is free and automatic. Afterwards, update **Site settings → Site address** and the Blogger snippet (re-run the import, or edit the address at the top of the snippet).

---

## Working on the site on your computer (optional)
```bash
npm install
npm run dev        # http://localhost:4321, drafts are visible here
npm run build      # builds the final site into dist/
```

## Where things are
| What | File |
|---|---|
| Posts | `src/content/posts/*.md` |
| About page | `src/content/pages/about.md` |
| Site title, bio, SEO codes, social links | `src/data/settings.json` (or **Admin → Site settings**) |
| Colours and fonts | `src/styles/global.css` |
| Admin panel fields | `public/admin/config.yml` |
| Default share image | `public/og-default.png` (1200 × 630) |
| SEO checks | `src/lib/posts.ts` (`seoChecks`) |
