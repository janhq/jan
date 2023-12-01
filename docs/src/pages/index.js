import React from "react";
import Dropdown from "@site/src/components/Elements/dropdown";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import AnnoncementBanner from "@site/src/components/Announcement";

import { AiOutlineGithub } from "react-icons/ai";

import ThemedImage from "@theme/ThemedImage";

import DownloadLink from "@site/src/components/Elements/downloadLink";

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <>
      <AnnoncementBanner />
      <Layout
        title={`${siteConfig.tagline}`}
        description="Jan is a ChatGPT-alternative that runs on your own computer, with a local API server."
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
            <div className="container pt-16">
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
          <div className="container mt-40 text-center">
            <h2>AI that you control</h2>
            <p className="text-base mt-2 w-full lg:w-2/5 mx-auto leading-relaxed">
              Private. Local. Infinitely Customizable.
            </p>
            <div className="grid text-left lg:grid-cols-2 mt-16 gap-4">
              <div className="card relative min-h-[380px] lg:min-h-[460px]">
                <img
                  src="/img/card-element.png"
                  alt="Element"
                  className="absolute w-full bottom-0 left-0"
                />
                <div className="p-8 relative z-40">
                  <h5>Personal AI that runs on your computer</h5>
                  <p className="mt-2">
                    Jan runs directly on your local machine, offering privacy,
                    convenience and customizability.
                  </p>
                  <ThemedImage
                    alt="Group Chat"
                    sources={{
                      light: useBaseUrl("/img/group-chat-light.png"),
                      dark: useBaseUrl("/img/group-chat-dark.png"),
                    }}
                    className="mt-10"
                  />
                </div>
              </div>
              <div className="card relative min-h-[380px] lg:min-h-[460px]">
                <div className="p-8">
                  <h5>Extendable via App and Plugin framework</h5>
                  <p className="mt-2">
                    Jan has a versatile app and plugin framework, allowing you
                    to customize it to your needs.
                  </p>
                </div>
                <ThemedImage
                  alt="Framework"
                  sources={{
                    light: useBaseUrl("/img/card-framework-light.png"),
                    dark: useBaseUrl("/img/card-framework-dark.png"),
                  }}
                  className="w-11/12 ml-auto mt-auto"
                />
              </div>
              <div className="card relative min-h-[380px] lg:min-h-[460px]">
                <div className="p-8">
                  <h5>
                    Private and offline, your data never leaves your machine
                  </h5>
                  <p className="mt-2">
                    Your conversations and data are with an AI that runs on your
                    computer, where only you have access.
                  </p>
                </div>
                <ThemedImage
                  alt="Group Chat"
                  sources={{
                    light: useBaseUrl("/img/card-nitro-light.png"),
                    dark: useBaseUrl("/img/card-nitro-dark.png"),
                  }}
                  className="w-3/4 mx-auto mt-auto"
                />
              </div>
              <div className="card relative min-h-[380px] lg:min-h-[460px]">
                <div className="p-8">
                  <h5>No subscription fees, the AI runs on your computer</h5>
                  <p className="mt-2">
                    Say goodbye to monthly subscriptions or usage-based APIs.
                    Jan runs 100% free on your own hardware.
                  </p>
                </div>
                <ThemedImage
                  alt="Group Chat"
                  sources={{
                    light: useBaseUrl("/img/card-free-light.png"),
                    dark: useBaseUrl("/img/card-free-dark.png"),
                  }}
                  className="w-full mt-auto mx-auto"
                />
              </div>
            </div>
          </div>

          <div className="container lg:px-20 py-40 lg:py-[200px] text-center lg:text-left">
            <div className="flex  flex-col lg:flex-row space-y-20 lg:space-y-0">
              <div>
                <h1 className="bg-gradient-to-r dark:from-white from-black to-gray-500 dark:to-gray-400 bg-clip-text text-4xl lg:text-6xl font-bold leading-tight text-transparent dark:text-transparent lg:leading-tight">
                  Your AI, forever.
                </h1>
                <p className="text-lg lg:text-2xl mt-2">
                  Apps come and go, but your AI and data should last.{" "}
                </p>
                <div className="w-full lg:w-3/4 mt-8">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-24">
                    <div>
                      <img
                        src="/img/ic-park-solid-unlock.svg"
                        alt="Icon - Lock"
                        className="w-8 mb-4 mx-auto lg:mx-0"
                      />
                      <p>
                        Jan uses open, standard and non-proprietary files stored
                        locally on your device.
                      </p>
                    </div>
                    <div>
                      <img
                        src="img/ic-baseline-control-camera.svg"
                        alt="Icon - Camera"
                        className="w-8 mb-4 mx-auto lg:mx-0"
                      />
                      <p>
                        You have total control over your AI, which means you can
                        use Jan offline and switch to another app easily if you
                        want.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full lg:w-80 text-center">
                <ThemedImage
                  alt="App screenshot"
                  sources={{
                    light: useBaseUrl("/img/jan-icon-light.png"),
                    dark: useBaseUrl("/img/jan-icon-dark.png"),
                  }}
                  className="w-40 lg:w-full mx-auto"
                />
                <p className="mt-1 font-bold">100% free on your own hardware</p>
                <DownloadLink />
              </div>
            </div>
          </div>

          <div className="container pb-40 text-center">
            <h2>
              We are open-source. <br /> Join Jan community.
            </h2>
            <div className="mt-14">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <a href="https://discord.com/invite/FTk2MvZwJH" target="_blank">
                  <div className="card h-52 relative flex items-center justify-center">
                    <div className="relative z-50">
                      <img
                        src="/img/discord-logo.png"
                        alt="Discord logo"
                        className="w-28"
                      />
                    </div>

                    <div className="card-link card-link-bg dark:card-link-bg-dark absolute right-4 top-5">
                      Join our Discord
                    </div>
                    <ThemedImage
                      alt="Discord Element"
                      sources={{
                        light: useBaseUrl("/img/discord-element-light.png"),
                        dark: useBaseUrl("/img/discord-element-dark.png"),
                      }}
                      className="absolute"
                    />
                  </div>
                </a>
                <a href="https://github.com/janhq/jan" target="_blank">
                  <div className="card h-52 relative flex items-center justify-center">
                    <div className="relative z-50">
                      <AiOutlineGithub className="text-8xl dark:text-white text-black" />
                    </div>
                    <div className="card-link card-link-bg dark:card-link-bg-dark absolute right-4 top-5">
                      View Github
                    </div>
                    <img
                      alt="Github Element"
                      src="/img/github-element-dark.png"
                      className="absolute left-8"
                    />
                  </div>
                </a>
              </div>
            </div>
          </div>
        </main>
      </Layout>
    </>
  );
}
