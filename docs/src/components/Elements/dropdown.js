import React from "react";
import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

const items = [
  { name: "Download for Mac (Intel)", href: "#" },
  { name: "Download for Windows", href: "#" },
  { name: "Download for Linux", href: "#" },
];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function Dropdown() {
  return (
    <div className="inline-flex">
      <button
        type="button"
        className="cursor-pointer relative inline-flex items-center rounded-l-md border-0 px-3.5 py-2.5 text-base font-semibold text-white bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        <img
          src={require("@site/static/img/apple-logo-white.png").default}
          alt="Logo"
          className="h-5 mr-3 -mt-1"
        />
        Download for Mac (Silicon)
      </button>
      <Menu as="div" className="relative -ml-px block">
        <Menu.Button className="cursor-pointer relative inline-flex items-center rounded-r-md border-0 border-l border-gray-300 h-12 text-white bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-500 dark:hover:bg-indigo-400">
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
          <Menu.Items className="absolute right-0 z-10 -mr-1 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            <div className="py-1">
              {items.map((item) => (
                <Menu.Item key={item.name}>
                  {({ active }) => (
                    <a
                      href={item.href}
                      className={classNames(
                        active ? "bg-gray-100 text-gray-900" : "text-gray-700",
                        "block px-4 py-2"
                      )}
                    >
                      {item.name}
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
