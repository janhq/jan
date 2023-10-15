import React from "react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/20/solid";
import { useColorMode } from "@docusaurus/theme-common";
import Dropdown from "@site/src/components/Elements/dropdown";

export default function HomepageHero() {
  const { colorMode } = useColorMode();

  return (
    <div className="bg-white dark:bg-gray-900">
      <div className="relative isolate md:pt-14 pt-0">
        {/* Background top gradient styling */}
        {colorMode === "dark" ? (
          <div
            className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
            aria-hidden="true"
          >
            <div
              className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
              style={{
                clipPath:
                  "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
              }}
            />
          </div>
        ) : (
          <div
            className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
            aria-hidden="true"
          >
            <div
              className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
              style={{
                clipPath:
                  "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
              }}
            />
          </div>
        )}

        {/* Main hero block */}
        <div className="py-24 lg:pb-40 animate-in fade-in zoom-in-50 duration-1000 ">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            {/* Hero text and buttons */}
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-6xl">
                Run your own AI
              </h1>
              <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300">
                Run Large Language Models locally on Mac, Windows or Linux.
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6">
                {/* TODO: handle mobile model download app instead */}
                <Dropdown />
                <button
                  type="button"
                  className="cursor-pointer relative inline-flex items-center rounded px-3.5 py-2 dark:py-2.5 text-base font-semibold text-blue-600 bg-white border-blue-600 dark:border-0 hover:bg-blue-600 dark:hover:bg-blue-500 hover:text-white"
                  onClick={() =>
                    window.open(
                      "https://github.com/janhq/jan",
                      "_blank",
                      "noreferrer"
                    )
                  }
                >
                  View Github
                  <ArrowTopRightOnSquareIcon className="h-5 w-5 ml-2" />
                </button>
              </div>
            </div>
            {/* Desktop screenshot image full width */}
            <img
              src={
                colorMode === "dark"
                  ? require("@site/static/img/desktop-llm-chat-dark.png")
                      .default
                  : require("@site/static/img/desktop-llm-chat-light.png")
                      .default
              }
              alt="App screenshot"
              width={2432}
              className="mt-16 rounded-lg md:rounded-2xl lg:rounded-3xl bg-white/5 shadow-2xl ring-1 ring-white/10 sm:mt-24"
            />
          </div>
        </div>
        {/* Background top gradient styling */}
        <div
          className="absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]"
          aria-hidden="true"
        >
          <div
            className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]"
            style={{
              clipPath:
                "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
