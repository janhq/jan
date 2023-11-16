/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars are explicitly defined here.

 Create as many sidebars as you want.
 */

// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  featuresSidebar: [
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

  docsSidebar: [
    {
      type: "category",
      label: "Getting Started",
      collapsible: false,
      collapsed: false,
      items: [
        "docs/introduction",
        {
          type: "category",
          label: "Installation",
          collapsible: true,
          collapsed: true,
          items: [
            "install/overview",
            "install/linux",
            "install/macOS",
            "install/windows",
          ],
        },
        "docs/quickstart",
      ],
    },
    {
      type: "category",
      label: "Building Jan",
      collapsible: false,
      collapsed: false,
      items: [
        "docs/user-interface",
        {
          type: "category",
          label: "Specifications",
          collapsible: true,
          collapsed: true,
          items: [
            "docs/specs/chats",
            "docs/specs/models",
            "docs/specs/threads",
            "docs/specs/messages",
            "docs/specs/assistants",
            "docs/specs/files",
          ],
        },
      ],
    },
  ],

  apiSidebar: [
    "api/overview",
    {
      type: "category",
      label: "Endpoints",
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: "autogenerated",
          dirName: "api",
        },
      ],
    },
  ],

  aboutSidebar: [
    {
      type: "doc",
      label: "About Jan",
      id: "about/about",
    },
    {
      type: "link",
      label: "Careers",
      href: "https://janai.bamboohr.com/careers",
    },
    {
      type: "category",
      label: "Events",
      collapsible: true,
      collapsed: true,
      items: [
        "events/nvidia-llm-day-nov-23",
        {
          type: "doc",
          label: "Oct 23: HCMC Hacker House",
          id: "events/hcmc-oct23",
        },
      ],
    },
    {
      type: "category",
      label: "Company Handbook",
      collapsible: true,
      collapsed: true,
      // link: { type: "doc", id: "handbook/handbook" },
      items: [
        {
          type: "doc",
          label: "Engineering",
          id: "handbook/engineering/engineering",
        },
      ],
    },
  ],
};

module.exports = sidebars;
