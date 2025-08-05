// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics'
import mermaid from 'astro-mermaid'

// https://astro.build/config
export default defineConfig({
  // Deploy to the new v2 subdomain
  site: 'https://v2.jan.ai',
  // No 'base' property is needed, as this will be deployed to the root of the subdomain.
  integrations: [
    mermaid({
      theme: 'default',
      autoTheme: true,
    }),
    starlight({
      title: '👋 Jan',
      favicon: 'jan2.png',
      plugins: [
        starlightThemeRapide(),
        starlightSidebarTopics(
          [
            {
              label: 'Jan Desktop',
              link: '/',
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
                          label: 'Code Sandbox (E2B)',
                          slug: 'jan/mcp-examples/data-analysis/e2b',
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
                    { label: 'Introduction', link: '/local-server/' },
                    { label: 'Server Setup', slug: 'local-server/api-server' },
                    {
                      label: 'Jan Data Folder',
                      slug: 'local-server/data-folder',
                    },
                    { label: 'Server Settings', slug: 'local-server/settings' },
                    {
                      label: 'Llama.cpp Server',
                      slug: 'local-server/llama-cpp',
                    },
                    {
                      label: 'Integrations',
                      collapsed: true,
                      autogenerate: { directory: 'local-server/integrations' },
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
              badge: { text: 'Coming Soon', variant: 'caution' },
              icon: 'phone',
              items: [{ label: 'Overview', slug: 'mobile' }],
            },
            {
              label: 'Jan Server',
              link: '/server/',
              badge: { text: 'Coming Soon', variant: 'caution' },
              icon: 'forward-slash',
              items: [{ label: 'Overview', slug: 'server' }],
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
