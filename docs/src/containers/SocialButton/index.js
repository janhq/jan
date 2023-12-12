import React from "react";
import { FaGithub, FaDiscord } from "react-icons/fa";
import { RiStarSFill } from "react-icons/ri";
import { useAppStars } from "@site/src/hooks/useAppStars";
import { useDiscordWidget } from "@site/src/hooks/useDiscordWidget";

export default function SocialButton() {
  const { stargazers } = useAppStars();
  const { data } = useDiscordWidget();

  return (
    <div className="flex items-center space-x-2 justify-start">
      <a
        href="https://github.com/janhq/jan"
        target="_blank"
        className="inline-flex px-4 py-3 rounded-lg font-semibold cursor-pointer justify-center items-center space-x-4 border border-gray-400 dark:border-gray-700 text-white bg-black hover:text-white"
      >
        <span>
          <FaGithub className="text-3xl" />
        </span>
        <div className="flex-col">
          <p className="text-base">Github</p>
          <p className="text-sm text-white flex items-center space-x-1">
            <RiStarSFill className="text-lg text-[#FEC928]" />
            <span>{stargazers.count} stars</span>
          </p>
        </div>
      </a>
      <a
        href="https://discord.gg/FTk2MvZwJH"
        target="_blank"
        className="text-white bg-[#5765F2] hover:bg-[#5765F2] hover:text-white inline-flex px-4 py-3 rounded-lg  font-semibold cursor-pointer justify-center items-center space-x-4"
      >
        <span>
          <FaDiscord className="text-3xl" />
        </span>
        <div className="flex-col">
          <p className="text-base">Discord</p>
          <div className="text-sm text-white flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span>{data.presence_count} online</span>
          </div>
        </div>
      </a>
    </div>
  );
}
