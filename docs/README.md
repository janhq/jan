# Jan Docs (stable and nightly)

Documentation for Jan Desktop and Jan Agent, built with
[Fumadocs](https://fumadocs.dev) on Next.js and exported as a static site to
Cloudflare Pages. The marketing site (jan.ai: home, download, blog, research,
changelog, handbook) lives in `janhq/jan.ai`.

## Develop

```bash
cd docs
yarn install
yarn dev          # stable, http://localhost:3000
yarn build        # static site in out/ (regenerates public/_redirects first)
yarn types:check
DOCS_CHANNEL=stable node scripts/check-channel.mjs  # after the matching build
```

### Channels

`DOCS_CHANNEL` is a build-time setting: `stable` (the default when unset) or
`nightly`. Other values fail configuration validation. It is inlined for both
server and client code, so changing it requires restarting development or
rebuilding the static export; setting it only on the deployed host has no effect.

```bash
DOCS_CHANNEL=nightly yarn dev
DOCS_CHANNEL=stable yarn build   # out/ for https://docs.jan.ai
DOCS_CHANNEL=nightly yarn build  # out/ for https://docs-nightly.jan.ai
```

Build channels sequentially: each build replaces `out/`. The channel selects
absolute canonical, Open Graph and sitemap URLs. Nightly shows a site-wide
warning linking to stable docs, blocks crawlers in `robots.txt`, and emits
`noindex, nofollow` metadata on every page. Stable remains indexable except for
pages with `noindex` frontmatter, which stay excluded from the sitemap in both
channels.

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

## Deployment and CI

The deployment workflow supplies `DOCS_CHANNEL` to the build and uploads `out/`
to the matching Cloudflare Pages project/domain. Stable release documentation
belongs on `docs.jan.ai`; development documentation from `main` belongs on
`docs-nightly.jan.ai`, not on the stable domain. PR previews should explicitly
select the appropriate channel too; the site does not infer a channel from the
branch name or hostname. Edit/source links target `docs-stable` for stable
builds and `main` for nightly builds. Deploy each channel's output before another
build replaces it.

Stable uses the existing `docs` Cloudflare deployment records (`Preview` and
`Production`); nightly uses new `docs-nightly` records (`Preview` and
`Production`) at `docs-nightly.jan.ai`. Neither channel has deployment approval
gates. After the docs migration lands on `main`, bootstrap the `docs-stable`
branch from that migrated revision before the first stable deployment; subsequent
stable documentation updates should be promoted to `docs-stable`.

- `.github/workflows/jan-docs.yml` owns builds, redirect checks and deployments,
  including PR previews (`pr-<number>`). Channel/branch selection is the
  workflow's responsibility.
- `.github/workflows/jan-docs-link-check.yml` runs lychee on the built site.
  Internal links block the PR. External links are checked weekly and reported
  in one issue.

## History

`scripts/migrate-content.mjs` converted the Nextra 2 site (`src/pages/docs`,
see git history before the Fumadocs move) into `content/`. It is kept for
reference; content is now edited directly. It refuses to run while `content/`
exists, because regenerating would discard every edit made since; `--force`
overrides that.
