# Jan's Website

This website is [built with Starlight](https://starlight.astro.build)


Starlight looks for `.md` or `.mdx` files in the `src/content/docs/` directory. Each file is exposed
as a route based on its file name.

Images can be added to `src/assets/` and embedded in Markdown with a relative link.

Static assets, like favicons, can be placed in the `public/` directory.

If you want to add new pages, these can go in the `src/pages/` directory. Because of the topics plugin
we are using ([starlight sidebar topics](https://starlight-sidebar-topics.netlify.app/docs/guides/excluded-pages/))
you will need to exclude them from the sidebar by adding them to the exclude list in `astro.config.mjs`, e.g., `exclude: ['/example'],`.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `bun install`             | Installs dependencies                            |
| `bun dev`             | Starts local dev server at `localhost:4321`      |
| `bun build`           | Build your production site to `./dist/`          |
| `bun preview`         | Preview your build locally, before deploying     |
| `bun astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `bun astro -- --help` | Get help using the Astro CLI                     |

## 📖 API Reference Commands

The website includes interactive API documentation. These commands help manage the OpenAPI specifications:

| Command                          | Action                                                    |
| :------------------------------- | :-------------------------------------------------------- |
| `bun run api:dev`               | Start dev server with API reference at `/api`            |
| `bun run api:local`             | Start dev server with local API docs at `/api-reference/local` |
| `bun run api:cloud`             | Start dev server with cloud API docs at `/api-reference/cloud` |
| `bun run generate:local-spec`   | Generate/fix the local OpenAPI specification             |
| `bun run generate:cloud-spec`   | Generate the cloud OpenAPI specification from Jan Server |
| `bun run generate:cloud-spec-force` | Force update cloud spec (ignores cache/conditions)   |

**API Reference Pages:**
- `/api` - Landing page with Local and Server API options
- `/api-reference/local` - Local API (llama.cpp) documentation  
- `/api-reference/cloud` - Jan Server API (vLLM) documentation

The cloud specification is automatically synced via GitHub Actions on a daily schedule and can be manually triggered by the Jan Server team.
