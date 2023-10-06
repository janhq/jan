import React from "react";
import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

const systems = [
  {
    name: "Download for Mac (M1/M2)",
    href: "https://github.com/janhq/jan/releases/download/v0.1.2/Jan-0.1.2-arm64.dmg",
    logo: require("@site/static/img/apple-logo-white.png").default,
  },
  {
    name: "Download for Mac (Intel)",
    href: "https://github.com/janhq/jan/releases/download/v0.1.2/Jan-0.1.2-arm64.dmg",
    logo: require("@site/static/img/apple-logo-white.png").default,
  },
  {
    name: "Download for Windows",
    href: "https://static.vecteezy.com/system/resources/previews/004/243/615/non_2x/creative-coming-soon-teaser-background-free-vector.jpg",
    logo: require("@site/static/img/windows-logo-white.png").default,
  },
  {
    name: "Download for Linux",
    href: "https://static.vecteezy.com/system/resources/previews/004/243/615/non_2x/creative-coming-soon-teaser-background-free-vector.jpg",
    logo: require("@site/static/img/linux-logo-white.png").default,
  },
];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function Dropdown() {
  const uAgent = window.navigator.userAgent;
  let defaultSystem;

  if (uAgent.indexOf("Win") !== -1) {
    defaultSystem = systems[2];
  } else if (uAgent.indexOf("Mac") !== -1) {
    // Note: There's no way to detect ARM architecture from browser. Hardcoding to M1/M2 for now.
    defaultSystem = systems[0];
  } else if (uAgent.indexOf("Linux") !== -1) {
    defaultSystem = systems[3];
  } else {
    defaultSystem = systems[0];
  }

  return (
    <div className="inline-flex align-items-stretch">
      <a
        className="cursor-pointer relative inline-flex items-center rounded-l-md border-0 px-3.5 py-2.5 text-base font-semibold text-white bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-500 dark:hover:bg-indigo-400 hover:text-white"
        href={defaultSystem.href}
      >
        <img
          src={require("@site/static/img/apple-logo-white.png").default}
          alt="Logo"
          className="h-5 mr-3 -mt-1"
        />
        {defaultSystem.name}
      </a>
      <Menu as="div" className="relative -ml-px block">
        <Menu.Button className="cursor-pointer relative inline-flex items-center rounded-r-md border-0 border-l border-gray-300 active:border-l active:border-white h-full text-white bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-500 dark:hover:bg-indigo-400">
          <span className="sr-only">Open OS options</span>
          <ChevronDownIcon className="h-5 w-5" aria-hidden="true" />
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
          <Menu.Items className="absolute right-0 z-10 mt-2 w-72 text-left origin-top-right rounded-md bg-indigo-600 dark:bg-indigo-500 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            <div className="py-1">
              {systems.map((system) => (
                <Menu.Item key={system.name}>
                  {({ active }) => (
                    <a
                      href={system.href}
                      className={classNames(
                        active
                          ? "bg-indigo-500 dark:hover:bg-indigo-400 hover:text-white"
                          : "text-white",
                        "block px-4 py-2"
                      )}
                    >
                      <img
                        src={system.logo}
                        alt="Logo"
                        className="w-3 mr-3 -mt-1"
                      />
                      {system.name}
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
