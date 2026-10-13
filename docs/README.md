# Jan Docs (docs.jan.ai)

Documentation for Jan Desktop and Jan Agent, built with
[Fumadocs](https://fumadocs.dev) on Next.js and exported as a static site to
Cloudflare Pages. The marketing site (jan.ai: home, download, blog, research,
changelog, handbook) lives in `janhq/jan.ai`.

## Develop

```bash
cd docs
yarn install
yarn dev          # http://localhost:3000
yarn build        # static site in out/ (regenerates public/_redirects first)
yarn types:check
```

## Write docs

- Pages are MDX in `content/`. `content/desktop/x.mdx` is served at
  `https://docs.jan.ai/desktop/x`.
- Sidebar order, separators (`---Title---`) and hidden pages (`!page`) are in
  each folder's `meta.json`. `desktop/` and `agent/` are `root` sections and
  show as the sidebar switcher.
- The frontmatter `title` is the page H1. Use `sidebarTitle` for a shorter
  sidebar label. `description`, `keywords`, `noindex` and `ogImage` are supported.
- Put images next to the page in `_assets/` and reference them relatively:
  `![Alt](./_assets/x.png)`.
- These components work without an import: `Callout`, `Steps` (each `###` is
  a step), `Tabs` with `Tabs.Tab`, `DocCard`/`DocCards`, `DownloadButton`,
  `FAQBox`, plus Fumadocs' defaults. ```` ```mermaid ```` blocks render too.
- Link to other pages with absolute paths (`/agent/skills`) or relative file
  paths. Don't link to private repos or internal issues.

## Redirects

`public/_redirects` is generated. Don't edit it by hand.

- `redirects/legacy-jan.ai.txt` is the old jan.ai `_redirects`, kept as input.
- `node scripts/build-redirects.mjs` writes `public/_redirects`, which is
  served by docs.jan.ai, and `redirects/jan.ai.txt`. That second file is the
  block janhq/jan.ai must ship so that every old `jan.ai/docs/*` URL reaches
  its final page in one 301.
- `node scripts/check-redirects.mjs` (after `yarn build`) follows every old URL
  through both sites offline and fails on dead ends or chains longer than 2 hops.

When you rename or delete a page, add `/docs/<old> /docs/<new> 301` to
`redirects/legacy-jan.ai.txt` and rebuild.

## CI

- `.github/workflows/jan-docs.yml` builds, checks the redirects, deploys
  PR previews (`pr-<number>`), and deploys `main` to the `jan-docs` Pages
  project (docs.jan.ai).
- `.github/workflows/jan-docs-link-check.yml` runs lychee on the built site.
  Internal links block the PR. External links are checked weekly and reported
  in one issue.

## History

`scripts/migrate-content.mjs` converted the Nextra 2 site (`src/pages/docs`,
see git history before the Fumadocs move) into `content/`. It is kept for
reference; content is now edited directly. It refuses to run while `content/`
exists, because regenerating would discard every edit made since; `--force`
overrides that.
