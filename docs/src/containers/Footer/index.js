import React from "react";

import { AiOutlineGithub, AiOutlineTwitter } from "react-icons/ai";
import { BiLogoDiscordAlt, BiLogoLinkedin } from "react-icons/bi";

const socials = [
  {
    icon: <AiOutlineTwitter className="text-xl text-black dark:text-white" />,
    href: "https://twitter.com/janframework",
  },
  {
    icon: <BiLogoDiscordAlt className="text-xl text-black dark:text-white" />,
    href: "https://discord.com/invite/FTk2MvZwJH",
  },
  {
    icon: <AiOutlineGithub className="text-lg text-black dark:text-white" />,
    href: "https://github.com/janhq/jan",
  },
  {
    icon: <BiLogoLinkedin className="text-xl text-black dark:text-white" />,
    href: "https://www.linkedin.com/company/janframework/",
  }
];

const menus = [
  {
    name: "For Developers",
    child: [
      {
        menu: "Documentation",
        path: "/developer",
      },
      {
        menu: "Hardware",
        path: "/hardware",
      },
      {
        menu: "API Reference",
        path: "/api-reference",
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
        path: "https://twitter.com/janframework",
        external: true,
      },
      {
        menu: "LinkedIn",
        path: "https://www.linkedin.com/company/janframework/",
        external: true,
      }
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
        menu: "Blog",
        path: "/blog",
      },
      {
        menu: "Careers",
        path: "https://janai.bamboohr.com/careers",
        external: true,
      },
      {
        menu: "Newsletter",
        path: "/community#newsletter",
      }
    ],
  },
];

const getCurrentYear = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="flex-shrink-0 dark:bg-[#09090B]/10 bg-[#D4D4D8]/10 relative overflow-hidden py-10">
      <div className="container">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-3 col-span-2">
            <div className="flex items-center space-x-2 mb-3">
              <img alt="Jan Logo" src="/img/logo.svg" />
              <h2 className="h6">Jan</h2>
            </div>
            <div className="w-full lg:w-1/2">
              <p className="dark:text-gray-400 text-gray-600">
                Jan is the open-source, self-hosted&nbsp;
                <br className="hidden lg:block" />
                &nbsp;alternative to ChatGPT.
              </p>

              <div className="mt-4">
                <div className="flex items-center gap-x-3">
                  {socials.map((social, i) => {
                    return (
                      <a
                        aria-label={`social-${i}`}
                        key={i}
                        href={social.href}
                        target="_blank"
                        rel="noopener"
                      >
                        {social.icon}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          {menus.map((menu, i) => {
            return (
              <div key={i} className="lg:text-right">
                <h2 className="mb-3 h6">{menu.name}</h2>
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
      <div className="container mt-6">
        <span className="dark:text-gray-300 text-gray-700">
          &copy;{getCurrentYear}&nbsp;Jan AI Pte Ltd.
        </span>
      </div>
    </footer>
  );
}
