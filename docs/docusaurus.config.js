// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require("prism-react-renderer/themes/github");
const darkCodeTheme = require("prism-react-renderer/themes/dracula");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Jan Documentation",
  tagline: "Self-hosted AI inference platform",
  favicon: "img/favicon.ico",
  // Set the production url of your site here
  url: "https://docs.jan.ai",
  title: "Jan",
  tagline: "Run your own AI",
  favicon: "img/favicon.ico",
  // Set the production url of your site here
  url: "https://jan.ai",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/",
  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "janhq", // Usually your GitHub org/user name.
  projectName: "jan", // Usually your repo name.
  onBrokenLinks: "ignore",
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",
  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // Plugins we added

  plugins: [
    async function myPlugin(context, options) {
      return {
        name: "docusaurus-tailwindcss",
        configurePostCss(postcssOptions) {
          // Appends TailwindCSS and AutoPrefixer.
          postcssOptions.plugins.push(require("tailwindcss"));
          postcssOptions.plugins.push(require("autoprefixer"));
          return postcssOptions;
        },
      };
    },
  ],


  // Only for react live
  themes: ["@docusaurus/theme-live-codeblock"],

  // The classic preset will relay each option entry to the respective sub plugin/theme.
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        // Will be passed to @docusaurus/plugin-content-docs (false to disable)
        docs: {
          routeBasePath: "/",
          sidebarPath: require.resolve("./sidebars.js"),
          editUrl: "https://github.com/janhq/jan/tree/main/docs",
          sidebarCollapsed: false,
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        // Will be passed to @docusaurus/plugin-content-sitemap (false to disable)
        sitemap: {
          changefreq: "weekly",
          priority: 0.5,
          changefreq: "daily",
          priority: 1.0,
          ignorePatterns: ["/tags/**"],
          filename: "sitemap.xml",
        },
        // Will be passed to @docusaurus/plugin-content-blog (false to disable)
        blog: {
          routeBasePath: "/blog",
          showReadingTime: true,
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/janhq/jan/tree/main/docs",
        },

        // Will be passed to @docusaurus/theme-classic.
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
        // Will be passed to @docusaurus/plugin-content-pages (false to disable)
        // pages: {},
      }),
    ],
    // Redoc preset
    [
      "redocusaurus",
      {
        specs: [
          {
            spec: "openapi/OpenAPISpec.json", // can be local file, url, or parsed json object
            route: "/reference/",
            route: "/api/",
          },
        ],
        theme: {
          primaryColor: "#1a73e8",
          primaryColorDark: "#1a73e8",
          // redocOptions: { hideDownloadButton: false },
        },
      },
    ],
  ],

  // Docs: https://docusaurus.io/docs/api/themes/configuration
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: "img/jan-social-card.png",
      // Only for react live
      liveCodeBlock: {
        playgroundPosition: "bottom",
      },
      navbar: {
        title: "Jan Docs",
        title: "Jan",
        logo: {
          alt: "Jan Logo",
          src: "img/logo.svg",
        },
        items: [
          // Navbar Top
          {
            type: "docSidebar",

            sidebarId: "quickstartSidebar",
            position: "left",
            label: "Getting Started",
          },
          {
            type: "docSidebar",
            sidebarId: "guidesSidebar",
            position: "left",
            label: "Guides",
          },
          {
            type: "docSidebar",
            sidebarId: "hardwareSidebar",
            position: "left",
            label: "Hardware",
            sidebarId: "featuresSidebar",
            position: "left",
            label: "Platform",
          },
          {
            type: "docSidebar",
            sidebarId: "solutionsSidebar",
            position: "left",
            label: "Use Cases",
          },
          {
            type: "docSidebar",
            sidebarId: "companySidebar",
            position: "left",
            label: "Company",
          },
          // Navbar right
          {
            type: "docSidebar",

            sidebarId: "integrationsSidebar",
            position: "left",
            label: "Integrations",
          },
          {
            position: "left",
            label: "Reference",
            to: "/reference",
          },
          {
            sidebarId: "integrationsSidebar",
            position: "left",
            label: "Changelog",
            to: "/blog",
          },

          // Navbar right
          {
            type: "docSidebar",
            sidebarId: "aboutSidebar",
            position: "right",
            label: "About",
            sidebarId: "docsSidebar",
            position: "right",
            label: "Docs",
          },
          {
            type: "docSidebar",
            sidebarId: "hardwareSidebar",
            position: "right",
            label: "Hardware",
          },
          {
            position: "right",
            label: "API",
            to: "/api",
          },
          {
            href: "https://github.com/janhq/jan",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Documentation",
            items: [
              {
                label: "Getting Started",
                to: "/",
              },
              {
                label: "Guides",
                to: "/guides",
            title: "Jan",
            items: [
              {
                label: "Home",
                to: "/",
              },
              {
                label: "Platform",
                to: "/platform",
              },
              {
                label: "Use Cases",
                to: "/solutions",
              },
            ],
          },
          {
            title: "Docs",
            items: [
              {
                label: "Developer",
                to: "/developer",
              },
              {
                label: "Reference",
                to: "/reference",
              },
              {
                label: "Changelog",
                to: "/blog",
                label: "Docs",
                to: "/docs",
              },
              {
                label: "Hardware",
                to: "/hardware",
              },
              {
                label: "API",
                to: "/api",
              },
              {
                label: "Changelog",
                to: "/changelog",
              },
            ],
          },
          {
            title: "Community",
            items: [
              {
                label: "Discord",
                href: "https://discord.gg/FTk2MvZwJH",

              },
              {
                label: "Telegram",
                href: "https://t.me/+cSSlxwEM-0piMDQ1",
              },
              {
                label: "Twitter",
                href: "https://twitter.com/askjanai",
              },
              {
                label: "Twitter",
                href: "https://twitter.com/jan_dotai",
              },
            ],
          },
          {
            title: "More",
            title: "Company",
            items: [
              {
                label: "About",
                to: "/about",
              },
              {
                label: "Blog",
                href: "https://blog.jan.ai",

                label: "Careers",
                href: "https://janai.bamboohr.com/careers",
              },
              {
                label: "GitHub",
                href: "https://github.com/janhq/jan",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Jan AI Pte Ltd.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ["python"],
      },
      colorMode: {
        defaultMode: "dark",
        disableSwitch: false,
        respectPrefersColorScheme: false,
      },
    }),
};

// Integrating PostHog product analytics with Docusaurus

config.plugins = [
  [
    "posthog-docusaurus",
    {
      apiKey: process.env.POSTHOG_API_KEY || "DEV",
      appUrl: "https://app.posthog.com", // optional
      enableInDevelopment: true, // optional
      // other options are passed to posthog-js init as is
    },
  ],
];

module.exports = config;
