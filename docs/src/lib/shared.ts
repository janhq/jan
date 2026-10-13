export const siteName = 'Jan'
export const siteUrl = 'https://docs.jan.ai'
export const marketingUrl = 'https://jan.ai'
export const defaultDescription =
  'Documentation for Jan Desktop and Jan Agent: run models locally or in the cloud, build and embed agents.'
export const defaultOgImage = '/assets/images/general/og-image-docs.png'

export const gitConfig = {
  user: 'janhq',
  repo: 'jan',
  branch: 'main',
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
