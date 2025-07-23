// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: '👋 Jan',
      favicon: "jan2.png",
      plugins: [
        starlightThemeRapide(),
        starlightSidebarTopics([
          {
            label: 'Jan',
            link: '/',
            icon: 'rocket',
            items: [
              {
                label: 'HOW TO',
                items: [
                  {
                    label: 'Install 👋 Jan',
                    collapsed: true,
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
                label: 'TUTORIALS',
                items: [
                  { label: 'Translation', slug: 'jan/tutorials/translation' },
                  {
                    label: 'Creative Writing',
                    slug: 'jan/tutorials/creative-writing',
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
                  {
                    label: 'MCP Examples',
                    collapsed: true,
                    autogenerate: { directory: 'jan/mcp-examples' },
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
            label: 'Local Server',
            link: '/local-server/',
            icon: 'setting',
            items: [
              { label: 'Server Setup', slug: 'local-server/api-server' },
              { label: 'Jan Data Folder', slug: 'local-server/data-folder' },
              { label: 'Settings', slug: 'local-server/settings' },
              { label: 'Llama.cpp', slug: 'local-server/llama-cpp' },
              {
                label: 'Integrations',
                collapsed: true,
                autogenerate: { directory: 'local-server/integrations' },
              },
              {
                label: 'Troubleshooting',
                slug: 'local-server/troubleshooting',
              },
            ],
          },
          {
            label: 'Products',
            link: '/products/',
            icon: 'forward-slash',
            items: [
              { label: 'Overview', slug: 'products' },
              {
                label: 'Platforms',
                autogenerate: { directory: 'products/platforms' },
              },
              {
                label: 'Tools',
                autogenerate: { directory: 'products/tools' },
              },
              {
                label: 'Models',
                autogenerate: { directory: 'products/models' },
              },
            ],
          },
        ]),
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/menloresearch/jan',
        },
      ],
    }),
  ],
})
