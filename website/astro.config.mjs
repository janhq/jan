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
        starlightSidebarTopics(
          [
            {
              label: 'Jan Desktop',
              link: '/jan/',
              icon: 'rocket',
              items: [
                {
                  label: 'HOW TO',
                  items: [
                    {
                      label: 'Install 👋 Jan',
                      collapsed: false,
                      autogenerate: { directory: 'jan/installation' },
                    },
                    { label: 'Start Chatting', slug: 'jan/threads' },
                    {
                      label: 'Use Jan Models',
                      collapsed: true,
                      autogenerate: { directory: 'jan/jan-models' },
                    },
                    { label: 'Assistants', slug: 'jan/assistants' },
                  ],
                },
                {
                  label: 'Cloud Providers',
                  items: [
                    { label: 'Anthropic', slug: 'jan/remote-models/anthropic' },
                    { label: 'OpenAI', slug: 'jan/remote-models/openai' },
                    { label: 'Gemini', slug: 'jan/remote-models/google' },
                    {
                      label: 'OpenRouter',
                      slug: 'jan/remote-models/openrouter',
                    },
                    { label: 'Cohere', slug: 'jan/remote-models/cohere' },
                    { label: 'Mistral', slug: 'jan/remote-models/mistralai' },
                    { label: 'Groq', slug: 'jan/remote-models/groq' },
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
                          label: 'Web Search with Exa',
                          slug: 'jan/mcp-examples/search/exa',
                        },
                      ],
                    },
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
            {
              label: 'Handbook',
              link: '/handbook/',
              icon: 'open-book',
              items: [
                { label: 'Welcome', slug: 'handbook' },
                {
                  label: 'About Jan',
                  items: [
                    {
                      label: 'Why does Jan Exist?',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/why' },
                    },
                    {
                      label: 'How we make Money',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/money' },
                    },
                    {
                      label: 'Who We Hire',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/who' },
                    },
                    {
                      label: "Jan's Philosophies",
                      collapsed: true,
                      autogenerate: { directory: 'handbook/philosophy' },
                    },
                    {
                      label: 'Brand & Identity',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/brand' },
                    },
                  ],
                },
                {
                  label: 'How We Work',
                  items: [
                    {
                      label: 'Team Roster',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/team' },
                    },
                    {
                      label: "Jan's Culture",
                      collapsed: true,
                      autogenerate: { directory: 'handbook/culture' },
                    },
                    {
                      label: 'How We Build',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/how' },
                    },
                    {
                      label: 'How We Sell',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/sell' },
                    },
                  ],
                },
                {
                  label: 'HR',
                  items: [
                    {
                      label: 'HR Lifecycle',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/lifecycle' },
                    },
                    {
                      label: 'HR Policies',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/hr' },
                    },
                    {
                      label: 'Compensation',
                      collapsed: true,
                      autogenerate: { directory: 'handbook/comp' },
                    },
                  ],
                },
              ],
            },
          ],
          {
            exclude: [
              '/prods',
              '/api-reference',
              '/products',
              '/products/**/*',
            ],
          }
        ),
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
      components: {
        Header: './src/components/CustomNav.astro',
      },
    }),
  ],
})
