import { docs } from 'fumadocs-mdx:collections/server'
import { llms, loader, type LoaderPlugin } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'

// Nextra's _meta.json gave pages a sidebar label that differed from their H1
// (e.g. "Install 👋 Jan", "Overview"). The migration stores it as
// `sidebarTitle`; use it for the sidebar node only.
const sidebarTitlePlugin: LoaderPlugin = {
  name: 'jan:sidebar-title',
  transformPageTree: {
    file(node, filePath) {
      if (!filePath) return node
      const file = this.storage.read(filePath)
      const label =
        file?.format === 'page'
          ? (file.data as { sidebarTitle?: string }).sidebarTitle
          : undefined
      if (label) node.name = label
      return node
    },
  },
}

// docs.jan.ai serves the docs at the site root: content/agent/x.mdx -> /agent/x.
export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  plugins: [sidebarTitlePlugin, lucideIconsPlugin()],
})

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
})
