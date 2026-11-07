import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional().nullable(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional().nullable(),
    coverAlt: z.string().optional().nullable(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    // Old Blogspot address, used for redirects after migration
    bloggerUrl: z.string().optional().nullable(),
    seo: z
      .object({
        title: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        focusKeyword: z.string().optional().nullable(),
        canonical: z.string().optional().nullable(),
        ogImage: z.string().optional().nullable(),
        noindex: z.boolean().default(false),
      })
      .default({ noindex: false }),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
  }),
});

export const collections = { posts, pages };
