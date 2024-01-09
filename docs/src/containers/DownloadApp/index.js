import React, { useState, useEffect } from "react";
import axios from "axios";
import { FaWindows, FaApple, FaLinux } from "react-icons/fa";
import { twMerge } from "tailwind-merge";

const systemsTemplate = [
  {
    name: "Mac M1, M2, M3",
    logo: FaApple,
    fileFormat: "{appname}-mac-arm64-{tag}.dmg",
    comingSoon: false,
  },
  {
    name: "Mac (Intel)",
    logo: FaApple,
    fileFormat: "{appname}-mac-x64-{tag}.dmg",
    comingSoon: false,
  },
  {
    name: "Windows",
    logo: FaWindows,
    fileFormat: "{appname}-win-x64-{tag}.exe",
  },
  {
    name: "Linux (AppImage)",
    logo: FaLinux,
    fileFormat: "{appname}-linux-x86_64-{tag}.AppImage",
  },
  {
    name: "Linux (deb)",
    logo: FaLinux,
    fileFormat: "{appname}-linux-amd64-{tag}.deb",
  },
];

export default function DownloadApp() {
  const [systems, setSystems] = useState(systemsTemplate);

  const getLatestReleaseInfo = async (repoOwner, repoName) => {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const extractAppName = (fileName) => {
    // Extract appname using a regex that matches the provided file formats
    const regex = /^(.*?)-(?:mac|win|linux)-(?:arm64|x64|amd64|x86_64)-.*$/;
    const match = fileName.match(regex);
    return match ? match[1] : null;
  };

  useEffect(() => {
    const updateDownloadLinks = async () => {
      try {
        const releaseInfo = await getLatestReleaseInfo("janhq", "jan");

        // Extract appname from the first asset name
        const firstAssetName = releaseInfo.assets[0].name;
        const appname = extractAppName(firstAssetName);

        if (!appname) {
          console.error(
            "Failed to extract appname from file name:",
            firstAssetName
          );

          return;
        }

        // Remove 'v' at the start of the tag_name
        const tag = releaseInfo.tag_name.startsWith("v")
          ? releaseInfo.tag_name.substring(1)
          : releaseInfo.tag_name;

        const updatedSystems = systems.map((system) => {
          const downloadUrl = system.fileFormat
            .replace("{appname}", appname)
            .replace("{tag}", tag);
          return {
            ...system,
            href: `https://github.com/janhq/jan/releases/download/${releaseInfo.tag_name}/${downloadUrl}`,
          };
        });

        setSystems(updatedSystems);
      } catch (error) {
        console.error("Failed to update download links:", error);
      }
    };

    updateDownloadLinks();
  }, []);

  return (
    <div>
      <div className="flex flex-col lg:flex-row items-center justify-center gap-4 mb-4">
        <span className="text-zinc-500 text-lg font-medium  inline-block">
          Download for PC
        </span>
        <div className="bg-yellow-50 text-yellow-700 space-x-2 px-4 py-2 border border-yellow-400 rounded-lg text-base">
          <span>🚧</span>
          <span className="font-semibold">Warning:</span>
          <span className="font-medium">
            Jan is in the process of being built. Expect bugs!
          </span>
        </div>
      </div>
      <div className="mx-auto text-center">
        {systems.map((system, i) => (
          <a
            key={i}
            href={system.href || ""}
            className={twMerge(
              "btn-shadow inline-flex m-2 px-4 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 border border-zinc-200 dark:border-gray-700 text-black dark:text-white bg-zinc-50 min-w-[150px] dark:bg-[#18181B] h-[36px]",
              system.comingSoon && "pointer-events-none"
            )}
          >
            <system.logo />
            <span className="text-sm">{system.name}</span>
            {system.comingSoon && (
              <span className="bg-zinc-200 py-0.5 px-2 inline-block ml-2 rounded-md text-xs h-[20px] dark:text-black">
                Coming Soon
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
