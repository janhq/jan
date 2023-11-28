import React, { useState, useEffect } from "react";
import axios from "axios";
import { FaWindows, FaApple, FaLinux } from "react-icons/fa";

const systemsTemplate = [
  {
    name: "Download for Mac (M1/M2)",
    logo: FaApple,
    fileFormat: "{appname}-mac-arm64-{tag}.dmg",
  },
  {
    name: "Download for Mac (Intel)",
    logo: FaApple,
    fileFormat: "{appname}-mac-x64-{tag}.dmg",
  },
  {
    name: "Download for Windows",
    logo: FaWindows,
    fileFormat: "{appname}-win-x64-{tag}.exe",
  },
  {
    name: "Download for Linux",
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
    const regex = /^(.*?)-(?:mac|win|linux)-(?:arm64|x64|amd64)-.*$/;
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
      <div className="flex flex-col gap-y-4">
        <div className="flex items-center space-x-4">
          <h6 className="w-[100px]">Windows</h6>
          {systems
            .filter((x) => x.name.includes("Windows"))
            .map((system) => (
              <a
                href={system.href}
                className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 border border-gray-400 dark:border-gray-700 text-gray-600 dark:text-white"
              >
                <system.logo />
                <span>{system.name}</span>
              </a>
            ))}
        </div>
        <div className="flex items-start lg:items-center space-x-4">
          <h6 className="w-[100px]">Mac</h6>
          <div className="flex flex-col lg:flex-row gap-4">
            {systems
              .filter((x) => x.name.includes("Mac"))
              .map((system) => (
                <a
                  href={system.href}
                  className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 border border-gray-400 dark:border-gray-700 text-gray-600 dark:text-white"
                >
                  <system.logo />
                  <span>{system.name}</span>
                </a>
              ))}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <h6 className="w-[100px]">Linux</h6>
          {systems
            .filter((x) => x.name.includes("Linux"))
            .map((system) => (
              <a
                href={system.href}
                className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 border border-gray-400 dark:border-gray-700 text-gray-600 dark:text-white"
              >
                <system.logo />
                <span>{system.name}</span>
              </a>
            ))}
        </div>
      </div>

      {/* {systems.map((system) => (
        <a
          href={system.href}
          className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 border border-gray-400 dark:border-gray-700 text-gray-600 dark:text-white"
        >
          <img
            src={system.logo}
            alt="Logo"
            className="w-3 mr-3 -mt-1 flex-shrink-0"
          />
          <span>{system.name}</span>
        </a>
      ))} */}
    </div>
  );
}
