import React, { useState, useEffect } from "react";
import axios from "axios";

const systemsTemplate = [
  {
    name: "Download for Mac (M1/M2)",
    logo: require("@site/static/img/apple-logo-white.png").default,
    fileFormat: "{appname}-mac-arm64-{tag}.dmg",
  },
  {
    name: "Download for Mac (Intel)",
    logo: require("@site/static/img/apple-logo-white.png").default,
    fileFormat: "{appname}-mac-x64-{tag}.dmg",
  },
  {
    name: "Download for Windows",
    logo: require("@site/static/img/windows-logo-white.png").default,
    fileFormat: "{appname}-win-x64-{tag}.exe",
  },
  {
    name: "Download for Linux",
    logo: require("@site/static/img/linux-logo-white.png").default,
    fileFormat: "{appname}-linux-amd64-{tag}.deb",
  },
];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function DownloadLink() {
  const [systems, setSystems] = useState(systemsTemplate);
  const [defaultSystem, setDefaultSystem] = useState(systems[0]);

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

  const changeDefaultSystem = async (systems) => {
    const userAgent = navigator.userAgent;

    const arc = await navigator?.userAgentData?.getHighEntropyValues([
      "architecture",
    ]);

    if (userAgent.includes("Windows")) {
      // windows user
      setDefaultSystem(systems[2]);
    } else if (userAgent.includes("Linux")) {
      // linux user
      setDefaultSystem(systems[3]);
    } else if (
      userAgent.includes("Mac OS") &&
      arc &&
      arc.architecture === "arm"
    ) {
      setDefaultSystem(systems[0]);
    } else {
      setDefaultSystem(systems[1]);
    }
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
          changeDefaultSystem(systems);
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
        changeDefaultSystem(updatedSystems);
      } catch (error) {
        console.error("Failed to update download links:", error);
      }
    };

    updateDownloadLinks();
  }, []);

  return (
    <div className="mt-2">
      <a href={defaultSystem.href}>
        <span className="text-blue-600 font-bold">Download Jan</span>
      </a>
    </div>
  );
}
