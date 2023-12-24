import React from "react";
import DownloadApp from "@site/src/containers/DownloadApp";

import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import Banner from "@site/src/containers/Banner";

import ThemedImage from "@theme/ThemedImage";

import SocialButton from "@site/src/containers/SocialButton";

import { IoArrowDown } from "react-icons/io5";

import Dropdown from "@site/src/containers/Elements/dropdown";

import useIsBrowser from "@docusaurus/useIsBrowser";

export default function Home() {
  const isBrowser = useIsBrowser();

  const handleAnchorLink = () => {
    document
      .getElementById("download-section")
      .scrollIntoView({ behavior: "smooth" });
  };

  const userAgent = isBrowser && navigator.userAgent;
  const isBrowserChrome = isBrowser && userAgent.includes("Chrome");

  return (
    <>
      <Banner />
      <Layout
        title="Open-source ChatGPT Alternative"
        description="Jan runs 100% offline on your computer, utilizes open-source AI models, prioritizes privacy, and is highly customizable."
      >
        <main>
          <div className="grid grid-cols-1 lg:grid-cols-12 -mt-1 gap-8 items-center relative min-h-[calc(100vh-96px)] ">
            <div className="col-span-full lg:col-start-2 lg:col-span-5 text-left relative z-10 px-4 py-6">
              <img
                src="/img/homepage/element-hero-blur.webp"
                alt="Element blur"
                className="hidden lg:block absolute blur-3xl opacity-30 right-32 -bottom-32"
              />
              <div className="flex items-center space-x-2 mb-3">
                <img alt="Jan Logo" src="img/logo.svg" width={36} height={36} />
                <span className="text-zinc-500 text-4xl font-medium">
                  Meet Jan
                </span>
              </div>
              <h1 className="text-5xl lg:text-7xl font-semibold leading-tight lg:leading-tight mt-2">
                Bringing AI to <br /> your Desktop{" "}
                <span className="relative w-16 h-16 inline-block">
                  <img
                    src="/img/homepage/element-hero-heading.png"
                    alt="Element hero heading"
                    className="object-contain inline-block"
                    width={64}
                    height={64}
                  />
                </span>
              </h1>
              <p className="text-2xl mt-3 leading-relaxed text-zinc-500">
                Open-source ChatGPT alternative that runs{" "}
                <br className="hidden lg:block" /> 100% offline on your
                computer.
              </p>
              <div className="mt-8"></div>
              <div className="mt-8">
                {!isBrowserChrome ? (
                  <div
                    onClick={() => handleAnchorLink()}
                    className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white scroll-smooth"
                  >
                    <span>Download Jan for PC</span>
                  </div>
                ) : (
                  <Dropdown />
                )}
              </div>

              <div
                onClick={() => handleAnchorLink()}
                className="hidden lg:inline-block cursor-pointer"
              >
                <div className="mt-16 flex items-center space-x-2">
                  <p>Find out more</p>
                  <IoArrowDown size={24} className="animate-bounce-down" />
                </div>
              </div>
            </div>

            <div className="col-span-full lg:col-span-6 h-full">
              <div className="relative text-center h-full">
                <ThemedImage
                  className="w-full object-cover mr-auto h-full"
                  alt="App screenshots"
                  sources={{
                    light: useBaseUrl(
                      "/img/homepage/app-base-screen-light.webp"
                    ),
                    dark: useBaseUrl("/img/homepage/app-base-screen-dark.webp"),
                  }}
                />
              </div>
            </div>
          </div>

          <div
            className="dark:bg-[#09090B]/20 border-t border-zinc-200 dark:border-gray-800 py-10 lg:py-16"
            id="download-section"
          >
            <div className="container">
              <div className="w-full lg:w-3/4 mx-auto">
                <DownloadApp />
              </div>
            </div>
          </div>

          <div className="dark:bg-[#09090B]/20 pb-10 lg:pb-36">
            <div className="container h-full ">
              <div className="w-full lg:w-3/4 mx-auto relative rounded-xl py-10">
                <img
                  src="/img/homepage/element-bg-open-source.webp"
                  alt="Element Open Source BG"
                  className="absolute w-full h-full object-cover rounded-xl top-0"
                />
                <div className="grid grid-cols-12 gap-4 px-4 items-center relative z-20">
                  <div className="col-span-full lg:col-span-7 order-2 lg:order-1 relative">
                    <div className="relative lg:-left-14 overflow-hidden rounded-lg group">
                      <div className="hidden group-hover:flex absolute top-0 left-0 rounded-lg bg-black/30 w-full h-full items-center justify-center transition-all">
                        <a
                          href="https://github.com/orgs/janhq/projects/5/views/16"
                          target="_blank"
                          className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 text-black bg-white hover:text-black"
                        >
                          <span>View Roadmap</span>
                        </a>
                      </div>
                      <img
                        src="/img/homepage/roadmap.webp"
                        alt="Element Roadmap"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                  <div className="col-span-full lg:col-span-5 order-1 lg:order-2 text-black">
                    <p className="text-4xl font-semibold">100% open source</p>
                    <p className="leading-relaxed w-full lg:w-3/4 mt-4">
                      Our core team believes that AI should be open source, and
                      Jan is built in public.
                    </p>
                    <div className="mt-6">
                      <SocialButton />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dark:bg-[#27272A] bg-zinc-100 pt-10 lg:pt-20 pb-10">
            <div className="container">
              <div className="w-full lg:w-3/4 mx-auto relative">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                  <div className="col-span-5">
                    <p className="text-3xl xl:text-4xl font-semibold">
                      Desktop App
                    </p>
                    <p className="text-zinc-600 dark:text-zinc-400 mt-4 text-lg leading-relaxed">
                      <b className="text-bold text-black dark:text-white">
                        10x productivity
                      </b>{" "}
                      with customizable AI <br className="hidden lg:block" />{" "}
                      assistants, global hotkeys, and in-line AI.
                    </p>
                  </div>
                  <div className="col-span-7">
                    <div className="bg-white dark:bg-[#09090B]/50 h-[375px] border border-zinc-200 dark:border-gray-800 rounded-xl overflow-hidden">
                      <ThemedImage
                        className="object-cover w-full object-center mx-auto h-full lg:-left-4 relative"
                        alt="App screenshots"
                        sources={{
                          light: useBaseUrl(
                            "/img/homepage/desktop-app-light.webp"
                          ),
                          dark: useBaseUrl(
                            "/img/homepage/desktop-app-dark.webp"
                          ),
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dark:bg-[#27272A] bg-zinc-100 lg:pb-20 pb-10 pt-10">
            <div className="container">
              <div className="w-full lg:w-3/4 mx-auto relative ">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                  <div className="col-span-5">
                    <div className="flex items-center">
                      <p className="text-3xl xl:text-4xl font-semibold">
                        Mobile App
                      </p>
                      <span className="bg-gray-300 dark:bg-gray-700 py-0.5 px-2 inline-block ml-2 rounded-lg text-sm mt-1 font-medium">
                        Coming Soon
                      </span>
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400 mt-4 text-lg leading-relaxed">
                      Take your AI assistants on the go.{" "}
                      <br className="hidden lg:block" /> Seamless integration
                      into your&nbsp;
                      <b className="text-bold text-black dark:text-white">
                        mobile <br className="hidden lg:block" /> workflows
                      </b>
                      &nbsp; with elegant features.
                    </p>
                  </div>
                  <div className="col-span-7">
                    <div className="bg-white dark:bg-[#09090B]/50 h-[375px] border border-zinc-200 dark:border-gray-800 rounded-xl">
                      <ThemedImage
                        className="object-cover w-full object-center mx-auto h-full"
                        alt="App screenshots"
                        sources={{
                          light: useBaseUrl(
                            "/img/homepage/mobile-app-light.webp"
                          ),
                          dark: useBaseUrl(
                            "/img/homepage/mobile-app-dark.webp"
                          ),
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dark:bg-[#09090B]/20">
            <div className="container py-12 lg:py-32">
              <div className="w-full xl:w-10/12 mx-auto relative">
                <div className="text-center">
                  <div className="card-link-bg dark:card-link-bg-dark px-4 py-2 inline-flex rounded-xl items-center space-x-6 h-[60px]">
                    <img
                      src="/img/homepage/ic-offline.webp"
                      alt="Icon Offline"
                      className="w-9 flex-shrink-0"
                    />
                    <img
                      src="/img/homepage/ic-private.webp"
                      alt="Icon Offline"
                      className="w-12 flex-shrink-0"
                    />
                    <img
                      src="/img/homepage/ic-folder.webp"
                      alt="Icon Offline"
                      className="w-9 flex-shrink-0"
                    />
                  </div>
                  <div className="mt-8">
                    <h2 className="text-3xl lg:text-4xl font-semibold">
                      Offline and Local First
                    </h2>
                    <p className="mt-2 text-zinc-600 dark:text-zinc-400 text-lg leading-relaxed">
                      Conversations, preferences, and model usage stay on{" "}
                      <br className="hidden lg:block" /> your computer—secure,
                      exportable, and can be deleted at any time.
                    </p>

                    <div className="grid grid-cols-12 mt-10 lg:mt-20 text-left gap-8">
                      <div className="col-span-full lg:col-span-4">
                        <div className="dark:bg-[#27272A] bg-zinc-100 rounded-xl p-8 min-h-[450px]">
                          <h2 className="text-3xl lg:text-4xl font-semibold">
                            OpenAI Compatible
                          </h2>
                          <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400 text-lg">
                            Jan provides an OpenAI-equivalent API{" "}
                            <br className="hidden lg:block" /> server at&nbsp;
                            <b>localhost:</b>&nbsp;
                            <span className="bg-blue-600 text-white font-bold py-0.5 px-2 rounded-lg">
                              1337
                            </span>{" "}
                            that can be used as a drop-in replacement with
                            compatible apps.
                          </p>

                          <div className="mt-6">
                            <div className="mb-4">
                              <div className="bg-white dark:bg-[#18181B] shadow-lg py-2 px-4 inline-flex rounded-xl">
                                <p className="font-medium">
                                  /chats/completions
                                </p>
                              </div>
                            </div>
                            <div className="mb-4">
                              <div className="bg-white dark:bg-[#18181B] shadow-lg py-2 px-4 inline-flex rounded-xl">
                                <p className="font-medium">
                                  Local server and API
                                </p>
                              </div>
                            </div>
                            <div className="mb-4">
                              <div className="bg-white dark:bg-[#18181B] shadow-lg py-2 px-4 inline-flex rounded-xl">
                                <p className="font-medium">
                                  <span className="inline-block mr-2">
                                    Assistants framework
                                  </span>
                                  <span className="bg-gray-300 dark:bg-gray-700 py-0.5 px-2 inline-block rounded-lg text-sm">
                                    Coming Soon
                                  </span>
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-full lg:col-span-8 items-center">
                        <div className="card-gradient rounded-xl h-full relative text-center min-h-[450px]">
                          <img
                            src="/img/homepage/status.webp"
                            alt="Element status"
                            className="w-10/12 lg:p-20 object-cover absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </Layout>
    </>
  );
}
