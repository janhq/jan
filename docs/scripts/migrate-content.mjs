#!/usr/bin/env node
/**
 * One-shot migration of the Nextra 2 docs (src/pages/docs) to Fumadocs
 * (content/). Re-runnable: it rebuilds content/ from the given source dir.
 *
 *   node scripts/migrate-content.mjs <old-pages-docs-dir>
 *
 * Get the old tree with:
 *   git archive <rev> docs/src/pages/docs | tar -x -C /tmp/old
 *   node scripts/migrate-content.mjs /tmp/old/docs/src/pages/docs
 *
 * What it does
 * - copies every .mdx and asset (keeps `_assets/` next to pages, so relative
 *   image paths keep working through fumadocs-mdx's remarkImage)
 * - _meta.json -> meta.json: order, titles (as page frontmatter when they
 *   differ), separators (`---Title---`), hidden pages (built but left out of
 *   the sidebar), section roots (`root: true` -> sidebar tabs)
 * - drops imports Fumadocs provides globally (nextra/components,
 *   nextra-theme-docs, @/components/DocCard|DownloadButton|FaqBox); keeps
 *   lucide-react imports
 * - rewrites internal links /docs/<x> -> /<x>
 * - removes the leading `# Title` when it equals the frontmatter title
 *   (Fumadocs renders the title itself)
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = process.argv[2]
if (!SRC || !fs.existsSync(SRC)) {
  console.error('usage: migrate-content.mjs <old src/pages/docs dir>')
  process.exit(1)
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'content')

// The old docs home (DocsHome) is now app/(home)/page.tsx.
const SKIP = new Set(['index.mdx', '_meta.json'])

const ROOT_SECTIONS = {
  desktop: { title: 'Jan Desktop', description: 'The desktop app', icon: 'Computer' },
  agent: { title: 'Jan Agent', description: 'The standalone agent', icon: 'Bot' },
}

const GLOBAL_IMPORT =
  /^import\s+[^;\n]*?from\s+['"](nextra\/components|nextra-theme-docs|@\/components\/(DocCard|DownloadButton|FaqBox))['"];?[ \t]*\n/gm

// Links that were already broken on jan.ai/docs (found by lychee), and
// marketing pages that now live on jan.ai.
// Frontmatter that was malformed on jan.ai/docs.
const FRONTMATTER_FIXES = {
  'desktop/install/mac.mdx': [
    'alternative to run offline.\n  [',
    'alternative to run offline.\nkeywords:\n  [',
  ],
}

const LINK_FIXES = [
  ['](/download)', '](https://jan.ai/download)'],
  ['](/changelog/', '](https://jan.ai/changelog/'],
  ['#add-models-1)', '#cloud-models)'],
  ['](docs/desktop/install/linux#uninstall-jan)', '](/desktop/install/linux#uninstall-jan)'],
  ['(#agentsmd-and-claudemd)', '(#janmd-and-claudemd)'],
  ['(https://www.jan.ai/docs/desktop/install/mac#minimum-requirements)', '(/desktop/install/mac#minimum-requirements)'],
  ['(https://www.jan.ai/docs/desktop/install/linux#compatibility)', '(/desktop/install/linux#compatibility)'],
  ['(/windows#compatibility)', '(/desktop/install/windows#compatibility)'],
  ['(/desktop/install/windows#step-2-handle-jan-data)', '(/desktop/install/windows#step-2-clean-up-remaining-files)'],
  ['(/desktop/model-parameters#model-capabilities-edit-button)', '(/desktop/model-parameters#how-to-access-settings)'],
  // Relative to the page itself; Nextra resolved it against /docs/desktop/.
  ['[hardware requirements](troubleshooting)', '[hardware requirements](/desktop/troubleshooting)'],
  // Fumadocs makes every heading a link; a link inside it nests <a> in <a>
  // (invalid HTML, React hydration error). Move the link into the text.
  [
    '#### 2. Import from [Hugging Face](https://huggingface.co/)\n\nYou can download models with a direct link from Hugging Face:',
    '#### 2. Import from Hugging Face\n\nYou can download models with a direct link from [Hugging Face](https://huggingface.co/):',
  ],
]

let stats = { pages: 0, assets: 0, metas: 0, links: 0, titles: 0 }

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name)
    const relPath = path.join(rel, entry.name)
    if (rel === '' && SKIP.has(entry.name)) continue
    const to = path.join(OUT, relPath)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      walk(from, relPath)
    } else if (entry.name === '_meta.json') {
      // handled per directory below
    } else if (entry.name.endsWith('.mdx')) {
      fs.writeFileSync(to, transformMdx(fs.readFileSync(from, 'utf8'), relPath))
      stats.pages++
    } else {
      fs.copyFileSync(from, to)
      stats.assets++
    }
  }
  const metaFile = path.join(dir, '_meta.json')
  if (fs.existsSync(metaFile) && rel !== '') writeMeta(dir, rel, metaFile)
}

function transformMdx(src, relPath) {
  let out = src

  // Imports that Fumadocs provides globally (see src/components/mdx.tsx).
  out = out.replace(GLOBAL_IMPORT, '')
  // FAQBox used to be a default import.
  out = out.replace(/^import\s+FAQBox\s+from\s+['"][^'"]+['"];?[ \t]*\n/gm, '')

  // Internal links: /docs/<x> -> /<x>; bare /docs -> /.
  out = out.replace(/(\]\(|href=["'{`]+)\/docs(\/[^)"'`\s]*)?/g, (_m, pre, rest) => {
    stats.links++
    return `${pre}${rest || '/'}`
  })

  for (const [from, to] of LINK_FIXES) out = out.split(from).join(to)
  const fmFix = FRONTMATTER_FIXES[relPath]
  if (fmFix) out = out.replace(fmFix[0], fmFix[1])

  // Nextra showed the page's first `# H1` and used the frontmatter title only
  // for <title>/sidebar. Fumadocs renders the frontmatter title as the H1, so
  // the first H1 (outside code fences, before any other heading) becomes the
  // title and is removed from the body. The old title is kept as sidebarTitle
  // when it differs, so the sidebar label stays the same.
  const fm = out.match(/^---\n([\s\S]*?)\n---\n/)
  if (fm) {
    const body = out.slice(fm[0].length)
    const firstHeading = findFirstHeading(body)
    if (firstHeading?.depth === 1) {
      const h1 = firstHeading.text
      const title = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]
      let front = fm[1]
      if (title !== h1) {
        front = title
          ? front.replace(/^title:.*$/m, `title: ${yamlStr(h1)}`) +
            (/^sidebarTitle:/m.test(front) ? '' : `\nsidebarTitle: ${yamlStr(title)}`)
          : `title: ${yamlStr(h1)}\n${front}`
      }
      const newBody = body.slice(0, firstHeading.index) + body.slice(firstHeading.index + firstHeading.raw.length)
      out = `---\n${front}\n---\n${newBody}`
    }
  }

  // Collapse 3+ blank lines left behind by removed imports.
  out = out.replace(/\n{3,}/g, '\n\n')
  return out
}

function writeMeta(dir, rel, metaFile) {
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  const pages = []
  for (const [key, value] of Object.entries(meta)) {
    const v = typeof value === 'string' ? { title: value } : value
    if (v.type === 'separator') {
      pages.push(`---${v.title}---`)
      continue
    }
    // Hidden in Nextra = built but not in the sidebar. Fumadocs builds every
    // file regardless of meta.json; `!key` keeps it out of the `...` rest.
    if (v.display === 'hidden') {
      pages.push(`!${key}`)
      // Nextra `type: "page"` = full-width page outside the docs layout.
      if (v.type === 'page') setFrontmatter(rel, key, 'layout', 'standalone')
      continue
    }
    pages.push(key)
    if (v.title) setTitle(dir, rel, key, v.title)
  }
  // Keep pages that exist but are missing from _meta.json (Nextra appends them).
  const out = { pages: [...pages, '...'] }
  const section = ROOT_SECTIONS[rel]
  if (section) Object.assign(out, { title: section.title, description: section.description, icon: section.icon, root: true })
  else {
    // Folder title from the parent _meta.json, if any.
    const parentMeta = path.join(path.dirname(dir), '_meta.json')
    if (fs.existsSync(parentMeta)) {
      const p = JSON.parse(fs.readFileSync(parentMeta, 'utf8'))[path.basename(dir)]
      const t = typeof p === 'string' ? p : p?.title
      if (t) out.title = t
    }
  }
  fs.writeFileSync(path.join(OUT, rel, 'meta.json'), JSON.stringify(out, null, 2) + '\n')
  stats.metas++
}

// Sidebar label from _meta.json. Fumadocs uses the page's frontmatter title for
// both the sidebar and the H1, so only add `sidebarTitle`-like override when
// they differ: we keep the page title and store the label as `title` only when
// the page has none.
function setTitle(dir, rel, key, label) {
  const file = path.join(OUT, rel, `${key}.mdx`)
  if (!fs.existsSync(file)) return // folder entries get their title in writeMeta
  let src = fs.readFileSync(file, 'utf8')
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/)
  if (!fm) {
    src = `---\ntitle: ${yamlStr(label)}\n---\n\n${src}`
  } else if (!/^title:/m.test(fm[1])) {
    src = src.replace(/^---\n/, `---\ntitle: ${yamlStr(label)}\n`)
  } else {
    // _meta.json labels win over any sidebarTitle set from the old title.
    const current = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]
    const withoutLabel = src.replace(/^sidebarTitle:.*\n/m, '')
    if (current !== label) {
      src = withoutLabel.replace(/^---\n/, `---\nsidebarTitle: ${yamlStr(label)}\n`)
      stats.titles++
    } else {
      src = withoutLabel
    }
  }
  fs.writeFileSync(file, src)
}

function setFrontmatter(rel, key, field, value) {
  const file = path.join(OUT, rel, `${key}.mdx`)
  if (!fs.existsSync(file)) return
  const src = fs.readFileSync(file, 'utf8')
  if (new RegExp(`^${field}:`, 'm').test(src)) return
  fs.writeFileSync(file, src.replace(/^---\n/, `---\n${field}: ${value}\n`))
}

// First ATX heading outside fenced code: { depth, text, raw, index }.
function findFirstHeading(body) {
  let inFence = false
  let offset = 0
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) return { depth: m[1].length, text: m[2], raw: line + '\n', index: offset }
    offset += line.length + 1
  }
  return null
}

const yamlStr = (s) => JSON.stringify(s)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

walk(SRC)
fs.writeFileSync(
  path.join(OUT, 'meta.json'),
  JSON.stringify({ pages: Object.keys(ROOT_SECTIONS) }, null, 2) + '\n'
)
console.log(stats)
