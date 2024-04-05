import React from "react";

import { useAppStars } from "@site/src/hooks/useAppStars";
import { useAppRelease } from "@site/src/hooks/useAppRelease";

import { AiOutlineGithub, AiOutlineTwitter } from "react-icons/ai";
import { BiLogoDiscordAlt } from "react-icons/bi";

const socials = [
  {
    icon: <AiOutlineTwitter className="text-xl text-white" />,
    href: "https://twitter.com/janframework",
  },
  {
    icon: <BiLogoDiscordAlt className="text-xl text-white" />,
    href: "https://discord.com/invite/FTk2MvZwJH",
  },
  {
    icon: <AiOutlineGithub className="text-lg text-white" />,
    href: "https://github.com/janhq/jan",
  },
];

export default function AnnoncementBanner() {
  const { stargazers } = useAppStars();
  const { release } = useAppRelease();

  return (
    <div className="h-10 w-full flex-shrink-0 bg-blue-600">
      <div className="px-4 lg:px-10 flex h-full items-center justify-between py-0.5">
        <div className="flex h-6 items-center shadow-sm">
          <a
            href="https://github.com/janhq/jan"
            target="_blank"
            className="flex h-full items-center gap-x-1 rounded-l-sm bg-indigo-50 px-1 py-0.5"
          >
            <AiOutlineGithub className="text-lg text-gray-800" />
            <span className="text-xs font-bold tracking-tight text-gray-800">
              Stars
            </span>
          </a>
          <a
            href="https://github.com/janhq/jan/stargazers"
            target="_blank"
            className="flex h-full items-center rounded-r-sm border-l border-gray-100 bg-white px-1 py-0.5 font-medium"
          >
            <span className="text-xs font-bold text-gray-700">
              {stargazers.count}
            </span>
          </a>
        </div>
        <a
          href="https://github.com/janhq/jan/releases"
          target="_blank"
          className="hidden items-center gap-x-2 lg:flex"
        >
          ✨
          <div className="flex items-center rounded bg-white px-2">
            <span className="font-bold uppercase text-blue-600">new</span>
          </div>
          <p className="text-white">
            <span className="font-bold capitalize">{release.tagVersion}</span>
            &nbsp;is now live on GitHub. Check it out!
          </p>
        </a>
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
  );
}
