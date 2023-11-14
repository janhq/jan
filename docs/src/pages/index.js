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
import { AiOutlineGithub, AiOutlineTwitter } from "react-icons/ai";

import ThemedImage from "@theme/ThemedImage";

const features = [
  {
    name: "Personal AI that runs on your computer",
    desc: "Jan runs directly on your local machine, offering privacy, convenience and customizability.",
  },
  {
    name: "Extendable via App and Plugin framework",
    desc: "Jan has a versatile app and plugin framework, allowing you to customize it to your needs.",
  },
  {
    name: "Private and offline, your data never leaves your machine",
    desc: "Your conversations and data are with an AI that runs on your computer, where only you have access.",
  },
  {
    name: "No subscription fees, the AI runs on your computer",
    desc: "Say goodbye to monthly subscriptions or usage-based APIs. Jan runs 100% free on your own hardware.",
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
            {/* <ThemedImage
              alt="App screenshot"
              sources={{
                light: useBaseUrl("/img/bg-hero-light.svg"),
                dark: useBaseUrl("/img/bg-hero-dark.svg"),
              }}
              className="absolute w-full h-full opacity-10 dark:opacity-20 top-0 object-cover blur-3xl"
            /> */}
            <div className="container py-16">
              <div className="grid grid-cols-1 items-center gap-4">
                <div className="relative z-10 text-center ">
                  {/* TODO: Add upcoming events here */}
                  {/* <div className="bg-red-50 mb-4 inline-flex items-center py-1 rounded-full px-4 gap-x-2">
                    <span className="font-bold uppercase text-blue-600">
                      Event
                    </span>
                    <a href="/events/nvidia-llm-day-nov-23">
                      <p className="font-bold">
                        8 Nov 2023: Nvidia LLM Day (Hanoi)
                      </p>
                    </a>
                  </div> */}

                  <h1 className="bg-gradient-to-r dark:from-white from-black to-gray-500 dark:to-gray-400 bg-clip-text text-4xl lg:text-6xl font-bold leading-tight text-transparent dark:text-transparent lg:leading-tight">
                    Own your AI
                  </h1>
                  <p className="text-xl leading-relaxed lg:text-2xl lg:leading-relaxed text-gray-500 dark:text-gray-400">
                    A &nbsp;
                    <span className="dark:text-white text-black">
                      free, open-source
                    </span>
                    &nbsp;alternative to OpenAI
                    <br />
                    &nbsp;that runs on your&nbsp;
                    <span className="dark:text-white text-black">
                      personal computer
                    </span>
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
          {/* <div className="container mt-10 mb-20 text-center">
            <h2>AI that you control</h2>
            <p className="text-base mt-2 w-full lg:w-2/5 mx-auto leading-relaxed">
              Private. Local. Infinitely Customizable.
            </p>
            <div className="grid text-left lg:grid-cols-2 mt-16 gap-16">
              {features.map((feat, i) => {
                return (
                  <div
                    className="flex gap-x-4 p-8 rounded-3xl border bg-gray-100 border-gray-100 dark:border-[#202231] dark:bg-[#111217]"
                    key={i}
                  >
                    <div>
                      <h5>{feat.name}</h5>
                      <p className="mt-2">{feat.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div> */}
          <div class="container">
            <div class="flex">
              <div>
                <h1 className="text-7xl">Your AI, forever.</h1>
                <p>Apps come and go, but your AI and data should last. </p>
              </div>
            </div>
          </div>
          <div class="container py-20 text-center">
            <h2>
              We are open-source. <br /> Join Jan community.
            </h2>
            <div class="mt-14">
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="card h-52 relative flex items-center justify-center">
                  <div class="relative z-50">
                    <img
                      src="/img/discord-logo.png"
                      alt="Discord logo"
                      className="w-28"
                    />
                  </div>
                  <a
                    href="https://discord.com/invite/FTk2MvZwJH"
                    target="_blank"
                  >
                    <div class="card-link card-link-bg dark:card-link-bg-dark absolute right-4 top-5">
                      Join our Discord
                    </div>
                  </a>
                  <ThemedImage
                    alt="Discord Element"
                    sources={{
                      light: useBaseUrl("/img/discord-element-light.png"),
                      dark: useBaseUrl("/img/discord-element-dark.png"),
                    }}
                    className="absolute"
                  />
                </div>
                <div class="card h-52 relative flex items-center justify-center">
                  <div class="relative z-50">
                    <AiOutlineGithub className="text-8xl dark:text-white text-black" />
                  </div>
                  <a href="https://github.com/janhq/jan" target="_blank">
                    <div class="card-link card-link-bg dark:card-link-bg-dark absolute right-4 top-5">
                      View Github
                    </div>
                  </a>
                  <img
                    alt="Github Element"
                    src="/img/github-element-dark.png"
                    className="absolute left-8"
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
      </Layout>
    </>
  );
}
