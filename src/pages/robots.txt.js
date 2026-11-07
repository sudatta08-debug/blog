export function GET({ site }) {
  return new Response(
    `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${new URL('/sitemap-index.xml', site).href}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}
