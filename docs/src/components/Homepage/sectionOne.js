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
    name: "1 Click Installs.",
    description:
      "Llama2, MPT, CodeLlama, and more. 1 click to install the latest and greatest models directly from HuggingFace. Or easily upload your own models.",
    icon: CursorArrowRaysIcon,
  },
  {
    name: "Model Management.",
    description:
      "Configure advanced settings for each model. Manage your model versions. Easily switch between models. Get visibility into hardware performance.",
    icon: HomeIcon,
  },
  {
    name: "Cloud AI Compatible. (Coming Soon)",
    description:
      "Connect to ChatGPT, Claude via an API key. Alternatively, host your own AI server on any GPU cloud and use it from the app.",
    icon: CloudArrowUpIcon,
  },
];

export default function HomepageSectionOne() {
  const { colorMode } = useColorMode();
  return (
    <div className="overflow-hidden bg-white dark:bg-gray-900 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <div className="lg:ml-auto lg:pl-4 lg:pt-4">
            <div className="lg:max-w-lg">
              <h2 className="text-base font-semibold leading-7 text-indigo-600 dark:text-indigo-400">
                Jan supports
              </h2>
              <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                Powerful Foundational Models
              </p>
              <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300">
                Open source foundational models are supported.
              </p>
              <dl className="mt-10 max-w-xl space-y-8 text-base leading-7 text-gray-600 dark:text-gray-300 lg:max-w-none">
                {features.map((feature) => (
                  <div key={feature.name} className="relative pl-9">
                    <dt className="inline font-semibold text-gray-900 dark:text-gray-300">
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
          <div className="flex items-start justify-end lg:order-first">
            <img
              src={
                colorMode === "dark"
                  ? // TODO replace with darkmode image
                    require("@site/static/img/desktop-explore-models-dark.png")
                      .default
                  : require("@site/static/img/desktop-explore-models-light.png")
                      .default
              }
              alt="Product screenshot"
              className="w-[48rem] max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 sm:w-[57rem]"
              width={2432}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
