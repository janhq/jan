// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightThemeNext from 'starlight-theme-next'
// import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics'
import mermaid from 'astro-mermaid'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://astro.build/config
export default defineConfig({
  // Deploy to the new v2 subdomain
  site: 'https://v2.jan.ai',
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@/components': path.resolve(__dirname, './src/components'),
        '@/layouts': path.resolve(__dirname, './src/layouts'),
        '@/assets': path.resolve(__dirname, './src/assets'),
        '@/content': path.resolve(__dirname, './src/content'),
        '@/styles': path.resolve(__dirname, './src/styles'),
        '@/utils': path.resolve(__dirname, './src/utils'),
      },
    },
    assetsInclude: [
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.png',
      '**/*.gif',
      '**/*.svg',
      '**/*.webp',
    ],
    optimizeDeps: {
      exclude: ['@astrojs/starlight'],
    },
  },
  integrations: [
    mermaid({
      theme: 'default',
      autoTheme: true,
    }),
    starlight({
      title: '👋 Jan',

      favicon: 'jan2.png',
      plugins: [
        // starlightThemeRapide(),
        starlightThemeNext(),
        starlightSidebarTopics([
          {
            label: 'Jan Desktop',
            link: '/',
            icon: 'rocket',
            items: [
              {
                label: 'GETTING STARTED',
                items: [
                  {
                    label: 'Install 👋 Jan',
                    collapsed: false,
                    autogenerate: { directory: 'jan/installation' },
                  },
                  { label: 'QuickStart', slug: 'jan/quickstart' },
                  {
                    label: 'Models',
                    collapsed: true,
                    autogenerate: { directory: 'jan/jan-models' },
                  },
                  { label: 'Assistants', slug: 'jan/assistants' },
                  {
                    label: 'Cloud Providers',
                    collapsed: true,
                    items: [
                      {
                        label: 'Anthropic',
                        slug: 'jan/remote-models/anthropic',
                      },
                      { label: 'OpenAI', slug: 'jan/remote-models/openai' },
                      { label: 'Gemini', slug: 'jan/remote-models/google' },
                      {
                        label: 'OpenRouter',
                        slug: 'jan/remote-models/openrouter',
                      },
                      { label: 'Cohere', slug: 'jan/remote-models/cohere' },
                      {
                        label: 'Mistral',
                        slug: 'jan/remote-models/mistralai',
                      },
                      { label: 'Groq', slug: 'jan/remote-models/groq' },
                    ],
                  },
                ],
              },
              {
                label: 'TUTORIALS',
                items: [
                  {
                    label: 'MCP Examples',
                    collapsed: true,
                    items: [
                      {
                        label: 'Browser Control (Browserbase)',
                        slug: 'jan/mcp-examples/browser/browserbase',
                      },
                      {
                        label: 'Code Sandbox (E2B)',
                        slug: 'jan/mcp-examples/data-analysis/e2b',
                      },
                      {
                        label: 'Design Creation (Canva)',
                        slug: 'jan/mcp-examples/design/canva',
                      },
                      {
                        label: 'Deep Research (Octagon)',
                        slug: 'jan/mcp-examples/deepresearch/octagon',
                      },
                      {
                        label: 'Serper Search',
                        slug: 'jan/mcp-examples/search/serper',
                      },
                      {
                        label: 'Web Search (Exa)',
                        slug: 'jan/mcp-examples/search/exa',
                      },
                    ],
                  },
                ],
              },
              {
                label: 'EXPLANATION',
                items: [
                  {
                    label: 'Local AI Engine',
                    slug: 'jan/explanation/llama-cpp',
                  },
                  {
                    label: 'Model Parameters',
                    slug: 'jan/explanation/model-parameters',
                  },
                ],
              },
              {
                label: 'ADVANCED',
                items: [
                  { label: 'Manage Models', slug: 'jan/manage-models' },
                  { label: 'Model Context Protocol', slug: 'jan/mcp' },
                ],
              },
              {
                label: 'Local Server',
                items: [
                  {
                    label: 'All',
                    collapsed: true,
                    autogenerate: { directory: 'local-server' },
                  },
                ],
              },
              {
                label: 'REFERENCE',
                items: [
                  { label: 'Settings', slug: 'jan/settings' },
                  { label: 'Jan Data Folder', slug: 'jan/data-folder' },
                  { label: 'Troubleshooting', slug: 'jan/troubleshooting' },
                  { label: 'Privacy Policy', slug: 'jan/privacy' },
                ],
              },
            ],
          },
          {
            label: 'Jan Mobile',
            link: '/mobile/',
            badge: { text: 'Soon', variant: 'caution' },
            icon: 'phone',
            items: [{ label: 'Overview', slug: 'mobile' }],
          },
          {
            label: 'Jan Server',
            link: '/server/',
            badge: { text: 'Soon', variant: 'caution' },
            icon: 'forward-slash',
            items: [{ label: 'Overview', slug: 'server' }],
          },
        ]),
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/menloresearch/jan',
        },
        {
          icon: 'x.com',
          label: 'X',
          href: 'https://twitter.com/jandotai',
        },
        {
          icon: 'discord',
          label: 'Discord',
          href: 'https://discord.com/invite/FTk2MvZwJH',
        },
      ],
    }),
  ],
})
