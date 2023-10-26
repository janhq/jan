/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  // By default, Docusaurus generates a sidebar from the docs folder structure

  // But you can create a sidebar manually
  featuresSidebar: [
    "platform/platform",
    {
      type: "category",
      label: "Products",
      collapsible: true,
      collapsed: false,
      link: { type: "doc", id: "products/products" },
      items: ["products/desktop", "products/mobile", "products/server"],
    },
    {
      type: "category",
      label: "Features",
      collapsible: true,
      collapsed: false,
      link: { type: "doc", id: "features/features" },
      items: [
        "features/ai-models",
        "features/control",
        "features/acceleration",
        "features/extensions",
      ],
    },
  ],

  // Note: Tab name is "Use Cases"
  solutionsSidebar: [
    // "solutions/solutions",
    {
      type: "category",
      label: "Solutions",
      collapsible: true,
      collapsed: false,
      items: ["solutions/self-hosted", "solutions/personal-ai"],
    },
    // {
    //   type: "category",
    //   label: "Industries",
    //   collapsible: true,
    //   collapsed: false,
    //   items: [
    //     "solutions/industries/software",
    //     "solutions/industries/education",
    //     "solutions/industries/law",
    //     "solutions/industries/public-sector",
    //     "solutions/industries/finance",
    //     "solutions/industries/healthcare",
    //   ],
    // },
  ],

  docsSidebar: [
    {
      type: "category",
      label: "Overview",
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: "doc",
          label: "Architecture",
          id: "docs/overview/architecture",
        },
        {
          type: "doc",
          label: "Concepts",
          id: "docs/overview/concepts",
        },
        {
          type: "doc",
          label: "App Anatomy",
          id: "docs/overview/app_anatomy",
        },
      ],
    },
    {
      type: "category",
      label: "Reference",
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: "doc",
          label: "@janhq/core",
          id: "docs/reference/coreservice",
        },
        {
          type: "doc",
          label: "@janhq/models",
          id: "docs/reference/model_catalog",
        },
        {
          type: "doc",
          label: "@janhq/plugins",
          id: "docs/reference/plugin_catalog",
        },
      ],
    },
    {
      type: "category",
      label: "Tutorials",
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: "doc",
          label: "How to Build a Chat App",
          id: "docs/tutorials/build-jan-app",
        },
        {
          type: "doc",
          label: "How to Build a RAG App",
          id: "docs/tutorials/build-rag-app",
        },
        {
          type: "doc",
          label: "How to Publish Apps on Jan",
          id: "docs/tutorials/publish-jan-app",
        },
      ],
    },
    {
      type: "category",
      label: "Articles",
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: "doc",
          label: "Nitro",
          id: "docs/articles/nitro",
        },
      ],
    },
  ],

  // guidesSidebar: [
  //   {
  //     type: "category",
  //     label: "Overview",
  //     collapsible: true,
  //     collapsed: true,
  //     items: [
  //       {
  //         type: "doc",
  //         label: "architecture",
  //         id: "docs/overview/architecture",
  //       },
  //     ],
  //   },
  // ],
  companySidebar: [
    // {
    //   type: "category",
    //   label: "About Jan",
    //   collapsible: true,
    //   collapsed: true,
    //   link: { type: "doc", id: "about/about" },
    //   items: [
    //     "about/team",
    //     {
    //       type: "link",
    //       label: "Careers",
    //       href: "https://janai.bamboohr.com/careers",
    //     },
    //   ],
    // },
    {
      type: "category",
      label: "Events",
      collapsible: true,
      collapsed: true,
      items: [
        {
          type: "doc",
          label: "Ho Chi Minh City (Oct 2023)",
          id: "events/hcmc-oct23",
        },
      ],
    },
    // {
    //   type: "category",
    //   label: "Company Handbook",
    //   collapsible: true,
    //   collapsed: true,
    //   link: { type: "doc", id: "handbook/handbook" },
    //   items: ["handbook/remote-work"],
    // },
  ],
};

module.exports = sidebars;
