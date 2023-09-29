import React from "react";
import {
  CircleStackIcon,
  CloudArrowUpIcon,
  CursorArrowRaysIcon,
  HomeIcon,
  LockClosedIcon,
  RocketLaunchIcon,
  ServerIcon,
} from "@heroicons/react/20/solid";
import { useColorMode } from "@docusaurus/theme-common";

const features = [
  {
    name: "Data Security and Privacy.",
    description:
      "Jan runs locally on your machine. Your data never leaves your computer. You can even run Jan offline.",
    icon: CloudArrowUpIcon,
  },
  {
    name: "Cross Device Compatible.",
    description:
      "Jan runs Nitro, a C++ inference engine, that is compatible with all major operating systems (CPU and GPU).",
    icon: LockClosedIcon,
  },
  {
    name: "Audit & compliance.",
    description: "Coming soon.",
    icon: ServerIcon,
  },
];

export default function sectionTwo() {
  const { colorMode } = useColorMode();
  return (
    <div className="overflow-hidden bg-white dark:bg-gray-900 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <div className="lg:pr-8 lg:pt-4">
            <div className="lg:max-w-lg">
              <h2 className="text-base font-semibold leading-7 text-indigo-600 dark:text-indigo-400">
                Jan gives you
              </h2>
              <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                AI that you control
              </p>
              <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300">
                Jan is a source-available, cross device, and privacy focused AI
                engine and Desktop app that runs locally on your machine.
              </p>
              <dl className="mt-10 max-w-xl space-y-8 text-base leading-7 text-gray-600 dark:text-gray-300 lg:max-w-none">
                {features.map((feature) => (
                  <div key={feature.name} className="relative pl-9">
                    <dt className="inline font-semibold text-gray-900 dark:text-white">
                      <feature.icon
                        className="absolute left-1 top-1 h-5 w-5 text-indigo-600 dark:text-indigo-400"
                        aria-hidden="true"
                      />
                      {feature.name}
                    </dt>{" "}
                    <dt>{feature.description}</dt>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <img
            src={
              colorMode === "dark"
                ? // TODO replace with darkmode image
                  require("@site/static/img/desktop-model-settings.png").default
                : require("@site/static/img/desktop-model-settings.png").default
            }
            alt="Product screenshot"
            className="w-[48rem] max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 sm:w-[57rem] md:-ml-4 lg:-ml-0"
            width={2432}
          />
        </div>
      </div>
    </div>
  );
}
