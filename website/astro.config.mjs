// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics'
import starlightUtils from '@lorenzo_lewis/starlight-utils'
import react from '@astrojs/react'

import mermaid from 'astro-mermaid'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://astro.build/config
export default defineConfig({
  // Deploy to the new v2 subdomain
  site: 'https://docs.jan.ai',
  integrations: [
    react(),
    mermaid({
      theme: 'default',
      autoTheme: true,
    }),
    starlight({
      title: '👋 Jan',
      favicon: 'favicon.ico',
      customCss: ['./src/styles/global.css'],
      head: [
        {
          tag: 'script',
          attrs: { src: '/scripts/inject-navigation.js', defer: true },
        },
        {
          tag: 'link',
          attrs: { rel: 'stylesheet', href: '/styles/navigation.css' },
        },
      ],

      plugins: [
        starlightThemeRapide(),
        starlightSidebarTopics(
          [
            {
              label: 'Jan',
              link: '/',
              icon: 'rocket',
              items: [{ label: 'Ecosystem', slug: 'index' }],
            },
            {
              label: 'Jan Desktop',
              link: '/jan/quickstart',
              icon: 'rocket',
              items: [
                {
                  label: '🚀 QUICK START',
                  items: [
                    { label: 'Getting Started', slug: 'jan/quickstart' },
                    {
                      label: 'Install Jan',
                      collapsed: false,
                      autogenerate: { directory: 'jan/installation' },
                    },
                    { label: 'AI Assistants', slug: 'jan/assistants' },
                  ],
                },
                {
                  label: '🤖 MODELS',
                  items: [
                    { label: 'Overview', slug: 'jan/manage-models' },
                    {
                      label: 'Jan Models',
                      collapsed: false,
                      items: [
                        {
                          label: 'Jan v1',
                          slug: 'jan/jan-models/jan-v1',
                        },
                        {
                          label: 'Research Models',
                          collapsed: true,
                          items: [
                            {
                              label: 'Jan Nano 32k',
                              slug: 'jan/jan-models/jan-nano-32',
                            },
                            {
                              label: 'Jan Nano 128k',
                              slug: 'jan/jan-models/jan-nano-128',
                            },
                            {
                              label: 'Lucy',
                              slug: 'jan/jan-models/lucy',
                            },
                          ],
                        },
                      ],
                    },
                    {
                      label: 'Cloud Providers',
                      collapsed: true,
                      items: [
                        { label: 'OpenAI', slug: 'jan/remote-models/openai' },
                        {
                          label: 'Anthropic',
                          slug: 'jan/remote-models/anthropic',
                        },
                        { label: 'Gemini', slug: 'jan/remote-models/google' },
                        { label: 'Groq', slug: 'jan/remote-models/groq' },
                        {
                          label: 'Mistral',
                          slug: 'jan/remote-models/mistralai',
                        },
                        { label: 'Cohere', slug: 'jan/remote-models/cohere' },
                        {
                          label: 'OpenRouter',
                          slug: 'jan/remote-models/openrouter',
                        },
                        {
                          label: 'HuggingFace 🤗',
                          slug: 'jan/remote-models/huggingface',
                        },
                      ],
                    },
                    {
                      label: 'Custom Providers',
                      slug: 'jan/custom-provider',
                    },
                    {
                      label: 'Multi-Modal Models',
                      slug: 'jan/multi-modal',
                    },
                  ],
                },
                {
                  label: '🔧 TOOLS & INTEGRATIONS',
                  items: [
                    { label: 'What is MCP?', slug: 'jan/mcp' },
                    {
                      label: 'Examples & Tutorials',
                      collapsed: true,
                      items: [
                        {
                          label: 'Web & Search',
                          collapsed: true,
                          items: [
                            {
                              label: 'Browser Control',
                              slug: 'jan/mcp-examples/browser/browserbase',
                            },
                            {
                              label: 'Serper Search',
                              slug: 'jan/mcp-examples/search/serper',
                            },
                            {
                              label: 'Exa Search',
                              slug: 'jan/mcp-examples/search/exa',
                            },
                          ],
                        },
                        {
                          label: 'Data & Analysis',
                          collapsed: true,
                          items: [
                            {
                              label: 'Jupyter Notebooks',
                              slug: 'jan/mcp-examples/data-analysis/jupyter',
                            },
                            {
                              label: 'Code Sandbox (E2B)',
                              slug: 'jan/mcp-examples/data-analysis/e2b',
                            },
                            {
                              label: 'Deep Financial Research',
                              slug: 'jan/mcp-examples/deepresearch/octagon',
                            },
                          ],
                        },
                        {
                          label: 'Productivity',
                          collapsed: true,
                          items: [
                            {
                              label: 'Linear',
                              slug: 'jan/mcp-examples/productivity/linear',
                            },
                            {
                              label: 'Todoist',
                              slug: 'jan/mcp-examples/productivity/todoist',
                            },
                          ],
                        },
                        {
                          label: 'Creative',
                          collapsed: true,
                          items: [
                            {
                              label: 'Design with Canva',
                              slug: 'jan/mcp-examples/design/canva',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  label: '⚙️ DEVELOPER',
                  items: [
                    {
                      label: 'Local API Server',
                      collapsed: true,
                      items: [
                        { label: 'Overview', slug: 'local-server' },
                        {
                          label: 'API Configuration',
                          slug: 'local-server/api-server',
                        },
                        {
                          label: 'Engine Settings',
                          slug: 'local-server/llama-cpp',
                        },
                        {
                          label: 'Server Settings',
                          slug: 'local-server/settings',
                        },
                        {
                          label: 'Integrations',
                          collapsed: true,
                          autogenerate: {
                            directory: 'local-server/integrations',
                          },
                        },
                      ],
                    },
                    {
                      label: 'Technical Details',
                      collapsed: true,
                      items: [
                        {
                          label: 'Model Parameters',
                          slug: 'jan/explanation/model-parameters',
                        },
                      ],
                    },
                  ],
                },
                {
                  label: '📚 REFERENCE',
                  items: [
                    { label: 'Settings', slug: 'jan/settings' },
                    { label: 'Data Folder', slug: 'jan/data-folder' },
                    { label: 'Troubleshooting', slug: 'jan/troubleshooting' },
                    { label: 'Privacy Policy', slug: 'jan/privacy' },
                  ],
                },
              ],
            },
            {
              label: 'Browser Extension',
              link: '/browser/',
              badge: { text: 'Alpha', variant: 'tip' },
              icon: 'puzzle',
              items: [{ label: 'Overview', slug: 'browser' }],
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
          ],
          {
            exclude: ['/api-reference', '/api-reference/**/*'],
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
    }),
  ],
})
