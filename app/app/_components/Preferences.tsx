"use client";
import { useEffect, useRef, useState } from "react";
import {
  setup,
  plugins,
  extensionPoints,
  activationPoints,
} from "../../electron/core/plugin-manager/execution/index";

import {
  ChartPieIcon,
  CommandLineIcon,
  HomeIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";

import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import classNames from "classnames";
import Link from "next/link";
const navigation = [
  { name: "Plugin Manager", href: "#", icon: ChartPieIcon, current: true },
];

/* eslint-disable @next/next/no-sync-scripts */
export const Preferences = () => {
  const [search, setSearch] = useState<string>("");
  const [activePlugins, setActivePlugins] = useState<any[]>([]);

  const preferenceRef = useRef(null);
  useEffect(() => {
    async function setupPE() {
      // Enable activation point management
      setup({
        //@ts-ignore
        importer: (plugin) =>
          import(/* webpackIgnore: true */ plugin).catch((err) => {
            console.log(err);
          }),
      });

      // Register all active plugins with their activation points
      await plugins.registerActive();
    }

    const activePlugins = async () => {
      const plgs = await plugins.getActive();
      setActivePlugins(plgs);
      // Activate alls
      setTimeout(async () => {
        await activationPoints.trigger("init");
        if (extensionPoints.get("experimentComponent")) {
          const components = await Promise.all(
            extensionPoints.execute("experimentComponent")
          );
          components.forEach((e) => {
            if (preferenceRef.current) {
              // @ts-ignore
              preferenceRef.current.appendChild(e);
            }
          });
        }
      }, 500);
    };
    setupPE().then(() => activePlugins());
  }, []);

  // Install a new plugin on clicking the install button
  const install = async (e: any) => {
    e.preventDefault();
    //@ts-ignore
    const pluginFile = new FormData(e.target).get("plugin-file").path;

    // Send the filename of the to be installed plugin
    // to the main process for installation
    const installed = await plugins.install([pluginFile]);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  // Uninstall a plugin on clicking uninstall
  const uninstall = async (name: string) => {
    //@ts-ignore

    // Send the filename of the to be uninstalled plugin
    // to the main process for removal
    //@ts-ignore
    const res = await plugins.uninstall([name]);
    console.log(
      res
        ? "Plugin successfully uninstalled"
        : "Plugin could not be uninstalled"
    );
  };

  // Update all plugins on clicking update plugins
  const update = async (plugin: string) => {
    if (typeof window !== "undefined") {
      // @ts-ignore
      await window.pluggableElectronIpc.update([plugin], true);
    }
    // plugins.update(active.map((plg) => plg.name));
  };

  return (
    <div className="w-full h-screen overflow-scroll">
      {/* Static sidebar for desktop */}
      <div className="fixed inset-y-0 z-50 flex w-72 flex-col">
        {/* Sidebar component, swap this element with another sidebar if you like */}
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4">
          <div className="flex h-16 shrink-0 items-center">
            <Link href="/">
              <img
                className="h-8 w-auto"
                src="icons/app_icon.svg"
                alt="Your Company"
              />
            </Link>
          </div>
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7">
              <li>
                <ul role="list" className="-mx-2 space-y-1">
                  {navigation.map((item) => (
                    <li key={item.name}>
                      <a
                        href={item.href}
                        className={classNames(
                          item.current
                            ? "bg-gray-800 text-white"
                            : "text-gray-400 hover:text-white hover:bg-gray-800",
                          "group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold"
                        )}
                      >
                        <item.icon
                          className="h-6 w-6 shrink-0"
                          aria-hidden="true"
                        />
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>

              <li className="mt-auto">
                <a
                  href="/"
                  className="group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 text-gray-400 hover:bg-gray-800 hover:text-white"
                >
                  <HomeIcon className="h-6 w-6 shrink-0" aria-hidden="true" />
                  Home
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>

      <div className="pl-72 w-full">
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white shadow-sm sm:gap-x-6 sm:px-6 px-8">
          {/* Separator */}
          <div className="h-6 w-px bg-gray-900/10 hidden" aria-hidden="true" />

          <div className="flex flex-1 self-stretch gap-x-6">
            <form className="relative flex flex-1" action="#" method="GET">
              <label htmlFor="search-field" className="sr-only">
                Search
              </label>
              <MagnifyingGlassIcon
                className="pointer-events-none absolute inset-y-0 left-0 h-full w-5 text-gray-400"
                aria-hidden="true"
              />
              <input
                defaultValue={search}
                onChange={(e) => setSearch(e.target.value)}
                id="search-field"
                className="block h-full w-full border-0 py-0 pl-8 pr-0 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
                placeholder="Search..."
                type="search"
                name="search"
              />
            </form>
          </div>
        </div>

        <main className="py-5">
          <div className="sm:px-6 px-8">
            {/* Content */}
            <div className="flex flex-row items-center my-4">
              <ChartPieIcon width={30} />
              Install Plugin
            </div>
            <form id="plugin-file" onSubmit={install}>
              <div className="flex flex-row items-center space-x-10">
                <div className="flex items-center justify-center w-[300px]">
                  <label className="flex flex-col items-center justify-center w-full border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:hover:bg-bray-800 dark:bg-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:bg-gray-600">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                        <span className="font-semibold">Click to upload</span>{" "}
                        or drag and drop
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        TGZ (MAX 50MB)
                      </p>
                    </div>
                    <input
                      id="dropzone-file"
                      name="plugin-file"
                      type="file"
                      className="hidden"
                      required
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  Install Plugin
                </button>
              </div>
            </form>

            <div className="flex flex-row items-center my-4">
              <CommandLineIcon width={30} />
              Installed Plugins
            </div>
            <div className="flex flex-wrap">
              {activePlugins
                .filter(
                  (e) =>
                    search.trim() === "" ||
                    e.name.toLowerCase().includes(search.toLowerCase())
                )
                .map((e) => (
                  <div key={e.name} className="m-2">
                    <a
                      href="#"
                      className="block max-w-sm p-6 bg-white border border-gray-200 rounded-lg shadow  dark:bg-gray-800 dark:border-gray-700"
                    >
                      <h5 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                        {e.name}
                      </h5>
                      <p className="font-normal text-gray-700 dark:text-gray-400">
                        Activation: {e.activationPoints}
                      </p>
                      <p className="font-normal text-gray-700 dark:text-gray-400">
                        Url: {e.url}
                      </p>
                      <div className="flex flex-row space-x-5">
                        <button
                          type="submit"
                          onClick={() => {
                            uninstall(e.name);
                          }}
                          className="mt-5 rounded-md bg-red-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                        >
                          Uninstall
                        </button>
                        <button
                          type="submit"
                          onClick={() => {
                            update(e.name);
                          }}
                          className="mt-5 rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                        >
                          Update
                        </button>
                      </div>
                    </a>
                  </div>
                ))}
            </div>
            <div className="flex flex-row items-center my-4">
              <PlayIcon width={30} />
              Test Plugins
            </div>
            <div className="h-full w-full" ref={preferenceRef}></div>
            {/* Content */}
          </div>
        </main>
      </div>
    </div>
  );
};
