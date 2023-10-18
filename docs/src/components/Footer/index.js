import React from "react";

const menus = [
  {
    name: "Resources",
    child: [
      {
        menu: "Home",
        path: "/",
      },
      {
        menu: "Platform",
        path: "/platform",
      },
      {
        menu: "Solutions",
        path: "/solutions",
      },
    ],
  },
  {
    name: "For Developers",
    child: [
      {
        menu: "Documentation (WIP)",
        path: "/docs",
      },
      {
        menu: "Hardware (WIP)",
        path: "/hardware",
      },
      {
        menu: "API (WIP)",
        path: "/api",
      },
      {
        menu: "Changelog",
        path: "https://github.com/janhq/jan/releases",
        external: true,
      },
    ],
  },
  {
    name: "Community",
    child: [
      {
        menu: "Github",
        path: "https://github.com/janhq/jan",
        external: true,
      },
      {
        menu: "Discord",
        path: "https://discord.gg/FTk2MvZwJH",
        external: true,
      },
      {
        menu: "Twitter",
        path: "https://twitter.com/janhq_",
        external: true,
      },
    ],
  },
  {
    name: "Company",
    child: [
      {
        menu: "About",
        path: "/about",
      },
      {
        menu: "Careers",
        path: "https://janai.bamboohr.com/careers",
        external: true,
      },
    ],
  },
];

const getCurrentYear = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="flex-shrink-0 border-t dark:border-gray-800 border-gray-200 py-10">
      <div className="container">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1">
            <h6 className="mb-3">Jan</h6>
            <p className="dark:text-gray-400 text-gray-600">
              Run Large Language Models locally on Windows, Mac and Linux.
              Available on Desktop and Cloud-Native.
            </p>
          </div>
          {menus.map((menu, i) => {
            return (
              <div key={i} className="lg:text-right">
                <h6 className="mb-3">{menu.name}</h6>
                <ul>
                  {menu.child.map((child, i) => {
                    return (
                      <li key={i}>
                        <a
                          href={child.path}
                          target={child.external ? "_blank" : "_self"}
                          className="inline-block py-1 dark:text-gray-400 text-gray-600"
                        >
                          {child.menu}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      <div className="container mt-8">
        <span className="dark:text-gray-300 text-gray-700">
          &copy;{getCurrentYear}&nbsp;Jan AI Pte Ltd.
        </span>
      </div>
    </footer>
  );
}
