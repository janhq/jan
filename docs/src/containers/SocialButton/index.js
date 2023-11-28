import React from "react";
import { FaGithub, FaDiscord } from "react-icons/fa";

export default function SocialButton() {
  return (
    <div className="flex items-center space-x-2 justify-center lg:justify-start">
      <a
        href="https://discord.gg/FTk2MvZwJH"
        target="_blank"
        className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 border border-gray-400 dark:border-gray-700 text-gray-600 dark:text-white"
      >
        <span>
          <FaDiscord className="text-xl" />
        </span>
        <span>Join our Discord</span>
      </a>
      <a
        href="https://github.com/janhq/jan"
        target="_blank"
        className="text-white bg-blue-600 hover:bg-blue-700 hover:text-white inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2"
      >
        <span>
          <FaGithub className="text-lg" />
        </span>
        <span>View on Github</span>
      </a>
    </div>
  );
}
