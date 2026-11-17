export const siteName = 'Jan Docs'
// Set by the build/development command, not by the deployed static host.
export const docsChannel = process.env.DOCS_CHANNEL ?? 'stable'
export const isNightly = docsChannel === 'nightly'
export const siteUrl = isNightly ? 'https://docs-nightly.jan.ai' : 'https://docs.jan.ai'
export const marketingUrl = 'https://jan.ai'
export const defaultDescription =
  'Everything you need to run Jan on your computer and in your terminal.'
// Link-preview image. Previews build their URLs from docs.jan.ai, so the
// file keeps this path (a new path would 404 on PR previews until merged);
// to change the image, replace the file and bump ?v= so social sites
// fetch it again instead of showing their cached copy.
export const defaultOgImage = '/assets/images/general/og-image-docs.png?v=2'

export const gitConfig = {
  user: 'janhq',
  repo: 'jan',
  branch: isNightly ? 'main' : 'docs-stable',
  contentDir: 'docs/content',
}

export function editUrl(path: string) {
  const { user, repo, branch, contentDir } = gitConfig
  return `https://github.com/${user}/${repo}/blob/${branch}/${contentDir}/${path}`
}

/** URL of the raw Markdown of a page (served by app/llms.mdx). */
export function pageMarkdownUrl(slugs: string[]) {
  return `/llms.mdx/${[...slugs, 'content.md'].join('/')}`
}
