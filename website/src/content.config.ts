import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { videosSchema } from 'starlight-videos/schemas';

const changelogSchema = z.object({
	title: z.string(),
	description: z.string(),
	date: z.date(),
	version: z.string().optional(),
	image: z.string().optional(),
	gif: z.string().optional(),
	video: z.string().optional(),
	featured: z.boolean().default(false),
});

const blogSchema = z.object({
	title: z.string(),
	description: z.string(),
	date: z.date(),
	tags: z.string().optional(),
	categories: z.string().optional(),
	author: z.string().optional(),
	ogImage: z.string().optional(),
	featured: z.boolean().default(false),
});

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema({ extend: videosSchema }) }),
	changelog: defineCollection({
		type: 'content',
		schema: changelogSchema,
	}),
	blog: defineCollection({
		type: 'content',
		schema: blogSchema,
	}),
};
