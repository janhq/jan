// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion
require('dotenv').config()

const darkCodeTheme = require('prism-react-renderer/themes/dracula')
const path = require('path')

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Jan | Rethink the Computer',
  tagline: 'Run your own AI',
  favicon: 'img/favicon.ico',

  // Set the production url of your site here
  url: 'https://jan.ai',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'janhq', // Usually your GitHub org/user name.
  projectName: 'jan', // Usually your repo name.

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  trailingSlash: true,
  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },

  noIndex: false,

  // Plugins we added
  plugins: [
    'docusaurus-plugin-sass',
    async function myPlugin(context, options) {
      return {
        name: 'docusaurus-tailwindcss',
        configurePostCss(postcssOptions) {
          // Appends TailwindCSS and AutoPrefixer.
          postcssOptions.plugins.push(require('tailwindcss'))
          postcssOptions.plugins.push(require('autoprefixer'))
          return postcssOptions
        },
      }
    },
    [
      'posthog-docusaurus',
      {
        apiKey: process.env.POSTHOG_PROJECT_API_KEY || 'XXX',
        appUrl: process.env.POSTHOG_APP_URL || 'XXX', // optional
        enableInDevelopment: false, // optional
      },
    ],
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          {
            from: '/troubleshooting/failed-to-fetch',
            to: '/troubleshooting/',
          },
          {
            from: '/guides/troubleshooting/gpu-not-used/',
            to: '/troubleshooting/',
          },
          {
            from: '/guides/troubleshooting/',
            to: '/troubleshooting/',
          },
          {
            from: '/troubleshooting/stuck-on-broken-build/',
            to: '/troubleshooting/',
          },
          {
            from: '/troubleshooting/somethings-amiss/',
            to: '/troubleshooting/',
          },
          {
            from: '/troubleshooting/how-to-get-error-logs/',
            to: '/troubleshooting/',
          },
          {
            from: '/troubleshooting/permission-denied/',
            to: '/troubleshooting/',
          },
          {
            from: '/troubleshooting/unexpected-token/',
            to: '/troubleshooting/',
          },
          {
            from: '/troubleshooting/undefined-issue/',
            to: '/troubleshooting/',
          },
          {
            from: '/install/',
            to: '/guides/install/',
          },
          {
            from: '/guides/using-models/',
            to: '/guides/models/',
          },
          {
            from: '/guides/using-extensions/',
            to: '/extensions/',
          },
          {
            from: '/integrations/tensorrt',
            to: '/guides/providers/tensorrt-llm',
          },
          {
            from: '/install/mac/',
            to: '/guides/install/mac/',
          },
          {
            from: '/guides/using-models/integrate-with-remote-server/',
            to: '/guides/engines/remote-server/',
          },
          {
            from: '/guides/chatting/manage-history/',
            to: '/guides/threads/',
          },
          {
            from: '/guides/using-server/',
            to: '/guides/local-api/',
          },
          {
            from: '/guides/using-models/customize-engine-settings/',
            to: '/guides/engines/llamacpp/',
          },
          {
            from: '/guides/integrations/openrouter/',
            to: '/integrations/openrouter/',
          },
          {
            from: '/docs/integrations/',
            to: '/integrations/',
          },
          {
            from: '/docs/product/chat/',
            to: '/developer/framework/product/chat/',
          },
          {
            from: '/install/windows/',
            to: '/guides/install/windows/',
          },
          {
            from: '/api/overview/',
            to: '/api-reference/',
          },
          {
            from: '/install/linux/',
            to: '/guides/install/linux/',
          },
          {
            from: '/install/from-source/',
            to: '/guides/install/#install-server-side',
          },
          {
            from: '/troubleshooting/gpu-not-used/',
            to: '/troubleshooting/#troubleshooting-nvidia-gpu',
          },
          {
            from: '/guides/using-server/server/',
            to: '/guides/local-api/#step-2-start-and-use-the-built-in-api-server',
          },
          {
            from: '/docs/integrations/openrouter/',
            to: '/integrations/openrouter/',
          },
          {
            from: '/docs/integrations/ollama/',
            to: '/guides/engines/ollama/',
          },
          {
            from: '/guides/using-models/install-from-hub/',
            to: '/guides/models/',
          },
          {
            from: '/guides/integrations/continue/',
            to: '/integrations/continue/',
          },
          {
            from: '/docs/engineering/assistants/',
            to: '/developer/framework/engineering/assistants/',
          },
          {
            from: '/guides/install/hardware/',
            to: '/guides/hardware/',
          },
          {
            from: '/docs/engineering/files/',
            to: '/developer/framework/engineering/files/',
          },
          {
            from: '/features/acceleration/',
            to: '/guides/advanced/#enable-the-gpu-acceleration',
          },
          {
            from: '/docs/extension-guides/',
            to: '/extensions/',
          },
          {
            from: '/specs/settings/',
            to: '/developer/framework/product/settings/',
          },
          {
            from: '/guides/using-models/import-models-using-absolute-filepath/',
            to: '/guides/models/',
          },
          {
            from: '/install/docker/',
            to: '/guides/install/server/',
          },
          {
            from: '/guides/using-models/import-manually/',
            to: '/guides/models/',
          },
          {
            from: '/v1/models',
            to: '/guides/models/',
          },
          {
            from: '/docs/team/contributor-program/',
            to: '/team/contributor-program/',
          },
          {
            from: '/guides/installation/hardware/',
            to: '/guides/hardware/',
          },
          {
            from: '/guides/chatting/start-thread/',
            to: '/guides/threads/',
          },
          {
            from: '/api/files/',
            to: '/developer/framework/engineering/files/#file-api',
          },
          {
            from: '/specs/threads/',
            to: '/developer/framework/engineering/threads/',
          },
          {
            from: '/guides/using-models/customize-models/',
            to: '/guides/models/',
          },
          {
            from: '/docs/modules/models/',
            to: '/guides/models/',
          },
          {
            from: '/developer/build-extension/package-your-assistant/',
            to: '/developer/extension/package-your-extension/',
          },
          {
            from: '/getting-started/install/linux/',
            to: '/guides/install/linux/',
          },
          {
            from: '/features/extensions',
            to: '/extensions/',
          },
          {
            from: '/specs/chats/',
            to: '/developer/framework/engineering/chats/',
          },
          {
            from: '/specs/engine/',
            to: '/developer/framework/engineering/engine/',
          },
          {
            from: '/docs/extension-capabilities/',
            to: '/extensions/',
          },
          {
            from: '/docs/get-started/use-local-server/',
            to: '/guides/local-api/',
          },
          {
            from: '/guides/how-jan-works/',
            to: '/guides/',
          },
          {
            from: '/guides/windows/',
            to: '/guides/install/windows/',
          },
          {
            from: '/specs/',
            to: '/developer/framework/',
          },
          {
            from: '/docs/get-started/build-extension/',
            to: '/developer/extension/',
          },
          {
            from: '/specs/files/',
            to: '/developer/framework/engineering/files/',
          },
          {
            from: '/guides/using-models/package-models/',
            to: '/guides/models/',
          },
          {
            from: '/install/overview/',
            to: '/guides/install/',
          },
          {
            from: '/docs/get-started/extension-anatomy/',
            to: '/developer/extension/extension-anatomy/',
          },
          {
            from: '/docs/get-started/',
            to: '/guides/',
          },
          {
            from: '/guides/mac/',
            to: '/guides/install/mac/',
          },
          {
            from: '/specs/fine-tuning/',
            to: '/developer/framework/engineering/fine-tuning/',
          },
          {
            from: '/guides/server/',
            to: '/guides/local-api/',
          },
          {
            from: '/specs/file-based/',
            to: '/developer/file-based/',
          },
          {
            from: '/developers/',
            to: '/developer/',
          },
          {
            from: '/api/',
            to: '/api-reference/',
          },
          {
            from: '/products/desktop',
            to: '/desktop/',
          },
          {
            from: '/developers/plugins/azure-openai',
            to: '/guides/engines/openai/',
          },
          {
            from: '/getting-started/install/mac',
            to: '/guides/install/mac/',
          },
          {
            from: '/guides/fine-tuning/what-models-can-be-fine-tuned',
            to: '/developer/framework/engineering/fine-tuning/',
          },
          {
            from: '/guides/linux/',
            to: '/guides/install/linux/',
          },
          {
            from: '/docs/specs/threads',
            to: '/developer/framework/engineering/threads/',
          },
          {
            from: '/docs/api-reference/models/list',
            to: '/api-reference#tag/models/get/models',
          },
          {
            from: '/docs/api-reference/threads',
            to: '/api-reference/#tag/chat/post/chat/completions',
          },
          {
            from: '/getting-started/troubleshooting',
            to: '/troubleshooting/',
          },
          {
            from: '/getting-started/install/windows',
            to: '/guides/install/windows/',
          },
          {
            from: '/docs/api-reference/messages',
            to: '/api-reference#tag/messages/get/threads/{thread_id}/messages',
          },
          {
            from: '/docs/modules/chats',
            to: '/developer/framework/engineering/chats/',
          },
          {
            from: '/docs/specs/chats',
            to: '/developer/framework/engineering/chats/',
          },
          {
            from: '/docs/api-reference/assistants',
            to: '/api-reference/#tag/assistants/get/assistants',
          },
          {
            from: '/docs/modules/files',
            to: '/developer/framework/engineering/files/',
          },
          {
            from: '/features/ai-models',
            to: '/guides/models/',
          },
          {
            from: '/docs/specs/models',
            to: '/developer/framework/engineering/models/',
          },
          {
            from: '/docs/models/overview',
            to: '/developer/framework/engineering/models/',
          },
          {
            from: '/docs/api-reference/models',
            to: '/api-reference#tag/models/get/models',
          },
          {
            from: '/docs/guides/fine-tuning',
            to: '/developer/framework/engineering/fine-tuning/',
          },
          {
            from: '/docs/specs/files',
            to: '/developer/framework/engineering/files/',
          },
          {
            from: '/docs/modules/threads',
            to: '/developer/framework/engineering/threads/',
          },
          {
            from: '/hardware/examples/3090x1-@dan-jan',
            to: '/guides/hardware/',
          },
          {
            from: '/chat',
            to: '/guides/threads/',
          },
          {
            from: '/docs/modules/assistants',
            to: '/developer/assistant/',
          },
        ],
      },
    ],

    //To input custom Plugin
    path.resolve(__dirname, 'plugins', 'changelog-plugin'),
    [
      '@scalar/docusaurus',
      {
        label: '',
        route: '/api-reference',
        configuration: {
          spec: {
            url: 'https://raw.githubusercontent.com/janhq/jan/dev/docs/openapi/jan.json',
          },
        },
      },
    ],
  ],

  // The classic preset will relay each option entry to the respective sub plugin/theme.
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        // Will be passed to @docusaurus/plugin-content-docs (false to disable)
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/janhq/jan/tree/dev/docs',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        // Will be passed to @docusaurus/plugin-content-sitemap (false to disable)
        sitemap: {
          changefreq: 'daily',
          priority: 1.0,
          ignorePatterns: ['/tags/**'],
          filename: 'sitemap.xml',
        },
        // Will be passed to @docusaurus/plugin-content-blog (false to disable)
        blog: {
          blogSidebarTitle: 'All Posts',
          blogSidebarCount: 'ALL',
        },
        // Will be passed to @docusaurus/theme-classic.
        theme: {
          customCss: require.resolve('./src/styles/main.scss'),
        },
        // GTM is always inactive in development and only active in production to avoid polluting the analytics statistics.
        googleTagManager: {
          containerId: process.env.GTM_ID || 'XXX',
        },
        // Will be passed to @docusaurus/plugin-content-pages (false to disable)
        // pages: {},
      },
    ],
    // Redoc preset
    [
      'redocusaurus',
      {
        specs: [
          {
            spec: 'openapi/jan.yaml', // can be local file, url, or parsed json object
            route: '/api-reference-1.0/', // path where to render docs
          },
        ],
        theme: {
          primaryColor: '#1a73e8',
          primaryColorDark: '#1a73e8',
          options: {
            requiredPropsFirst: true,
            noAutoAuth: true,
            hideDownloadButton: true,
          },
        },
      },
    ],
  ],

  // Docs: https://docusaurus.io/docs/api/themes/configuration
  themeConfig: {
    image: 'img/og-image.png',
    // Only for react live
    liveCodeBlock: {
      playgroundPosition: 'bottom',
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: false,
      },
    },
    // Algolia Search Configuration
    algolia: {
      appId: process.env.ALGOLIA_APP_ID || 'XXX',
      apiKey: process.env.ALGOLIA_API_KEY || 'XXX',
      indexName: 'jan_docs',
      contextualSearch: true,
      insights: true,
    },
    // SEO Docusarus
    metadata: [
      {
        name: 'description',
        content: `Jan turns your computer into an AI machine by running LLMs locally on your computer. It's a privacy-focus, local-first, open-source solution.`,
      },
      {
        name: 'keywords',
        content:
          'Jan, Rethink the Computer, local AI, privacy focus, free and open source, private and offline, conversational AI, no-subscription fee, large language models',
      },
      { name: 'robots', content: 'index, follow' },
      {
        property: 'og:title',
        content: 'Jan | Rethink the Computer',
      },
      {
        property: 'og:description',
        content: `Jan turns your computer into an AI machine by running LLMs locally on your computer. It's a privacy-focus, local-first, open-source solution.`,
      },
      {
        property: 'og:image',
        content: 'https://jan.ai/img/og-image.png',
      },
      { property: 'og:type', content: 'website' },
      { property: 'twitter:card', content: 'summary_large_image' },
      { property: 'twitter:site', content: '@janframework' },
      {
        property: 'twitter:title',
        content: 'Jan | Rethink the Computer',
      },
      {
        property: 'twitter:description',
        content: `Jan turns your computer into an AI machine by running LLMs locally on your computer. It's a privacy-focus, local-first, open-source solution.`,
      },
      {
        property: 'twitter:image',
        content: 'https://jan.ai/img/og-image.png',
      },
    ],
    headTags: [
      // Declare a <link> preconnect tag
      {
        tagName: 'link',
        attributes: {
          rel: 'preconnect',
          href: 'https://jan.ai/',
        },
      },
      // Declare some json-ld structured data
      {
        tagName: 'script',
        attributes: {
          type: 'application/ld+json',
        },
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org/',
          '@type': 'Organization',
          name: 'Jan',
          url: 'https://jan.ai/',
          logo: 'https://jan.ai/img/og-image.png',
        }),
      },
    ],
    navbar: {
      title: 'Jan',
      logo: {
        alt: 'Jan Logo',
        src: 'img/logo.svg',
      },
      items: [
        // Navbar Left
        // {
        //   type: "docSidebar",
        //   sidebarId: "aboutSidebar",
        //   position: "left",
        //   label: "About",
        // },
        {
          type: 'dropdown',
          label: 'About',
          position: 'left',
          items: [
            {
              type: 'doc',
              label: 'What is Jan?',
              docId: 'about/about',
            },
            {
              type: 'doc',
              label: 'Who we are',
              docId: 'team/team',
            },
            {
              type: 'doc',
              label: 'Wall of love',
              docId: 'wall-of-love',
            },
          ],
        },
        {
          type: 'docSidebar',
          sidebarId: 'productSidebar',
          positionL: 'left',
          label: 'Product',
        },
        {
          type: 'docSidebar',
          sidebarId: 'ecosystemSidebar',
          position: 'left',
          label: 'Ecosystem',
        },
        {
          to: 'download',
          position: 'left',
          label: 'Download',
        },
        // {
        //   type: "docSidebar",
        //   sidebarId: "pricingSidebar",
        //   positionl: "left",
        //   label: "Pricing",
        // },
        // Navbar right
        {
          type: 'dropdown',
          label: 'Docs',
          to: 'docs',
          position: 'right',
          items: [
            {
              type: 'docSidebar',
              sidebarId: 'guidesSidebar',
              label: 'Guides',
            },
            {
              type: 'docSidebar',
              sidebarId: 'developerSidebar',
              label: 'Developer',
            },
            {
              to: '/api-reference',
              label: 'API Reference',
            },
            {
              type: 'docSidebar',
              sidebarId: 'releasesSidebar',
              label: 'Changelog',
            },
            // {
            //   type: "docSidebar",
            //   sidebarId: "docsSidebar",
            //   label: "Framework",
            // },
          ],
        },
        {
          to: 'blog',
          label: 'Blog',
          position: 'right',
        },
      ],
    },
    prism: {
      theme: darkCodeTheme,
      darkTheme: darkCodeTheme,
      additionalLanguages: [
        'python',
        'powershell',
        'bash',
        'json',
        'javascript',
        'jsx',
      ],
    },
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
  },

  themes: ['@docusaurus/theme-live-codeblock', '@docusaurus/theme-mermaid'],
}

module.exports = config
