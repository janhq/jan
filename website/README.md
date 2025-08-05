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
