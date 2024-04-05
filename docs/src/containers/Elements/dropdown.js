import React, { useState, useEffect } from "react";
import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import axios from "axios";
import { FaWindows, FaApple, FaLinux } from "react-icons/fa";

const systemsTemplate = [
  {
    name: "Download for Mac (M1/M2/M3)",
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
    name: "Download for Linux (AppImage)",
    logo: FaLinux,
    fileFormat: "{appname}-linux-x86_64-{tag}.AppImage",
  },
  {
    name: "Download for Linux (deb)",
    logo: FaLinux,
    fileFormat: "{appname}-linux-amd64-{tag}.deb",
  }
];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function Dropdown() {
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
    const regex = /^(.*?)-(?:mac|win|linux)-(?:arm64|x64|x86_64|amd64)-.*$/;
    const match = fileName.match(regex);
    return match ? match[1] : null;
  };

  const changeDefaultSystem = async (systems) => {
    const userAgent = navigator.userAgent;

    if (userAgent.includes("Windows")) {
      // windows user
      setDefaultSystem(systems[2]);
    } else if (userAgent.includes("Linux")) {
      // linux user
      setDefaultSystem(systems[3]);
    } else if (userAgent.includes("Mac OS")) {
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
    <div className="inline-flex align-items-stretch">
      <a
        href={defaultSystem.href || ""}
        className="cursor-pointer relative inline-flex items-center rounded-l-md border-0 px-4 py-3 text-base font-semibold dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white"
      >
        <defaultSystem.logo className="h-5 mr-3 -mt-1" />
        {defaultSystem.name}
      </a>
      <Menu as="div" className="relative -ml-px block">
        <Menu.Button className="cursor-pointer relative inline-flex items-center rounded-r-md border-l border-gray-600 h-full dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white w-8 justify-center">
          <span className="sr-only">Open OS options</span>
          <ChevronDownIcon className="h-6 w-6" aria-hidden="true" />
        </Menu.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 z-10 mt-1 w-80 text-left origin-top-right rounded-md dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden">
            <div className="overflow-hidden">
              {systems.map((system) => (
                <Menu.Item
                  key={system.name}
                  onClick={() => setDefaultSystem(system)}
                >
                  {({ active }) => (
                    <a
                      href={system.href || ""}
                      className={classNames(
                        active
                          ? "dark:bg-blue-100 bg-gray-900 hover:text-white dark:text-black"
                          : "text-white dark:text-black",
                        "flex px-4 py-3 items-center text-white hover:text-white dark:text-black"
                      )}
                    >
                      <system.logo className="w-3 mr-3 -mt-1 flex-shrink-0" />
                      <span className="text-white dark:text-black font-medium">
                        {system.name}
                      </span>
                    </a>
                  )}
                </Menu.Item>
              ))}
            </div>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  );
}
