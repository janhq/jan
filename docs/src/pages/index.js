import React from "react";
import Dropdown from "@site/src/components/Elements/dropdown";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import AnnoncementBanner from "@site/src/components/Announcement";
import {
  CloudArrowUpIcon,
  CursorArrowRaysIcon,
  ShieldCheckIcon,
  CpuChipIcon,
  ClipboardDocumentIcon,
  CubeTransparentIcon,
  ComputerDesktopIcon,
  FolderPlusIcon,

} from "@heroicons/react/24/outline";

import ThemedImage from "@theme/ThemedImage";

const features = [
  {
    name: "Personal AI that runs on your computer",
    desc: "Jan runs directly on your local machine, offering privacy, convenience and customizability.",
    icon: ComputerDesktopIcon,
  },
  {
    name: "Private and offline, your data never leaves your machine",
    desc: "Your conversations and data are with an AI that runs on your computer, where only you have access.",
    icon: ShieldCheckIcon,
  },
  {
    name: "No subscription fees, the AI runs on your computer",
    desc: "Say goodbye to monthly subscriptions or usage-based APIs. Jan runs 100% free on your own hardware.",
    icon: CubeTransparentIcon,
  },
  {
    name: "Extendable via App and Plugin framework",
    desc: "Jan has a versatile app and plugin framework, allowing you to customize it to your needs.",
    icon: FolderPlusIcon
  },
  
];

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <>
      <AnnoncementBanner />
      <Layout
        title={`${siteConfig.tagline}`}
        description="Jan runs Large Language Models locally on Windows, Mac and Linux.
              Available on Desktop and Cloud-Native."
      >
        <main className="bg-gray-50 dark:bg-gray-950/95 relative">
          <div className="relative">
            <ThemedImage
              alt="App screenshot"
              sources={{
                light: useBaseUrl("/img/bg-hero-light.svg"),
                dark: useBaseUrl("/img/bg-hero-dark.svg"),
              }}
              className="absolute w-full h-full opacity-10 dark:opacity-20 top-0 object-cover blur-3xl"
            />
            <div className="container py-16">
              <div className="grid grid-cols-1 items-center gap-4">
                <div className="relative z-10 text-center ">
                  <div className="bg-red-50 mb-4 inline-flex items-center py-1 rounded-full px-4 gap-x-2">
                    <span className="font-bold uppercase text-blue-600">
                      Event
                    </span>
                    <a href="/events/hcmc-oct23">
                      <p className="font-bold">
                        24-28 Oct: Jan's AI Hacker House (Ho Chi Minh City)
                      </p>
                    </a>
                  </div>

                  <h1 className="bg-gradient-to-r dark:from-white from-black to-gray-500 dark:to-gray-400 bg-clip-text text-4xl lg:text-6xl font-bold leading-tight text-transparent dark:text-transparent lg:leading-tight">
                    Personal AI
                  </h1>
                  <p className="text-xl leading-relaxed lg:text-2xl lg:leading-relaxed text-gray-500 dark:text-gray-400">
                    {/* Run Large Language Models locally on&nbsp;
                    <span className="dark:text-white text-black">Mac</span>
                    ,&nbsp;
                    <span className="dark:text-white text-black">Windows</span>
                    &nbsp;or&nbsp;
                    <span className="dark:text-white text-black">Linux</span>. */}
                    Jan is a powerful&nbsp;
                    <span className="dark:text-white text-black">Personal AI</span>
                    &nbsp;built to run locally on your machine,
                    <br/>
                    with a rich&nbsp;
                    <span className="dark:text-white text-black">app</span>&nbsp;and&nbsp;
                    <span className="dark:text-white text-black">plugin ecosystem</span>.
                  </p>

                  <div className="my-6 flex flex-col-reverse md:flex-row items-center justify-center gap-4 relative z-20">
                    <button
                      type="button"
                      className="cursor-pointer relative hidden md:inline-flex items-center px-4 py-2.5  text-base font-semibold rounded-lg border border-gray-400 dark:border-gray-700 text-gray-600 dark:text-white"
                      onClick={() =>
                        window.open(
                          "https://github.com/janhq/jan",
                          "_blank",
                          "noreferrer"
                        )
                      }
                    >
                      View Github
                    </button>
                    <Dropdown />
                  </div>
                </div>

                <div className="text-center relative ">
                  {/* <div className="el-blur-hero absolute -left-40 w-full top-1/2 -translate-y-1/2" /> */}
                  <div className="p-3 border dark:border-gray-500 border-gray-400 inline-block rounded-lg">
                    <ThemedImage
                      alt="App screenshot"
                      sources={{
                        light: useBaseUrl("/img/desktop-llm-chat-light.png"),
                        dark: useBaseUrl("/img/desktop-llm-chat-dark.png"),
                      }}
                      width={1000}
                      className="rounded-md mx-auto"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="container mt-10 mb-20 px-48 text-center">
            <h2>AI that you control</h2>
            <p className="text-base mt-2 w-full lg:w-2/5 mx-auto leading-relaxed">
              Jan runs Large Language Models locally on Windows, Mac and Linux.
              Available on Desktop and Cloud-Native.
            </p>
            <div className="grid text-left lg:grid-cols-2 mt-16 gap-16">
              {features.map((feat, i) => {
                return (
                  <div className="flex gap-x-4" key={i}>
                    <feat.icon
                      className="h-6 w-6 text-indigo-600 dark:text-indigo-400 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <div>
                      <h6>{feat.name}</h6>
                      <p className="mt-2">{feat.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </Layout>
    </>
  );
}
