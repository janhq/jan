import React from "react";
import DownloadApp from "@site/src/containers/DownloadApp";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import Banner from "@site/src/containers/Banner";

import ThemedImage from "@theme/ThemedImage";

import SocialButton from "@site/src/containers/SocialButton";

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <>
      <Banner />
      <Layout
        title={`${siteConfig.tagline}`}
        description="Jan is a ChatGPT-alternative that runs on your own computer, with a local API server."
      >
        <main>
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-12 mt-4 gap-8 items-center relative">
              <div className="col-span-full lg:col-span-5 lg:text-left text-center relative z-10">
                <h1 className="bg-gradient-to-b dark:from-white from-black to-gray-700 dark:to-gray-400 bg-clip-text text-6xl font-black leading-tight text-transparent dark:text-transparent lg:leading-tight">
                  Own your AI
                </h1>
                <p className="text-2xl mt-1">
                  Jan is an open-source alternative to ChatGPT that runs on your
                  own computer.
                </p>
                <div className="mt-8">
                  <SocialButton />
                </div>
              </div>
              <div className="col-span-full lg:col-span-7">
                <div className="relative text-center">
                  <ThemedImage
                    className="rounded-xl w-full lg:w-10/12 border border-gray-200 dark:border-gray-800"
                    alt="App screenshots"
                    sources={{
                      light: useBaseUrl(
                        "/img/homepage/app-base-screen-light.png"
                      ),
                      dark: useBaseUrl(
                        "/img/homepage/app-base-screen-dark.png"
                      ),
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* <div className="bg-gray-50 dark:bg-[#09090B]/20 border-y border-gray-00 dark:border-gray-800 mt-10 py-10">
            <div className="container">
              <div className="w-full lg:w-3/4 mx-auto">
                <DownloadApp />
              </div>
            </div>
          </div> */}

          {/* <div className="container py-14">
            <div className="mb-10">
              <h2 className="h1 text-center lg:text-left">Explore Jan</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="card relative">
                <div className="p-8 mb-8">
                  <h4>Take Control</h4>
                  <p className="mt-2">
                    Jan runs 100% on your own machine, privately, predictably
                    and even in offline, with no surprise bills
                  </p>
                </div>
                <img
                  src="img/homepage/full-control.svg"
                  alt="Full Control Illustration"
                  className="relative -bottom-2 left-0"
                />
              </div>

              <div className="card relative">
                <div className="p-8 mb-8">
                  <h4>100% Open Source</h4>
                  <p className="mt-2">
                    Say goodbye to black boxes. Jan has well-documented code and
                    stores data in open-format files that you can inspect,
                    verify and tinker with.
                  </p>
                </div>
                <img
                  src="img/homepage/open-source.svg"
                  alt="Full Control Illustration"
                  className="relative -bottom-2 left-0"
                />
              </div>

              <div className="card relative">
                <div className="p-8 mb-8">
                  <h4>Extensions</h4>
                  <p className="mt-2">
                    Jan has a powerful Extensions API inspired by VSCode. In
                    fact, most of Jan's core services are built as extensions.
                  </p>
                </div>
                <img
                  src="img/homepage/extentions.svg"
                  alt="Extentions Illustration"
                  className="relative -bottom-2 left-0"
                />
              </div>
            </div>
          </div> */}

          {/* <div className="container mt-8 pb-16 relative">
            <div className="text-center">
              <h2 className="h1">No-fuss Compatibility</h2>
              <p className="mt-2 leading-relaxed">
                Jan's API aims to be a drop-in replacement for OpenAI's REST
                API, <br /> with a local server that runs at port{" "}
                <span className="bg-indigo-600 py-1 px-2 text-white font-bold rounded-full">
                  1337
                </span>
              </p>
            </div>
            <div className="w-full lg:w-1/2 mx-auto mt-10">
              <h4 className="mb-4">Endpoints</h4>
              <div className="flex flex-col gap-y-4">
                <div className="dark:bg-[#27272A]/50 bg-[#F4F4F5]/50 border border-gray-300 dark:border-none py-2 px-4 rounded-md relative">
                  <div className="flex gap-x-2 items-center">
                    <p>/chat/completions</p>
                  </div>
                  <div className="absolute bg-yellow-500 py-1 px-2 rounded-lg top-1 right-1">
                    <span className="text-sm text-yellow-800 font-semibold">
                      Partial
                    </span>
                  </div>
                </div>
                <div className="dark:bg-[#27272A]/50 bg-[#F4F4F5]/50 border border-gray-300 dark:border-none py-2 px-4 rounded-md relative">
                  <div className="flex gap-x-2 items-center">
                    <p>/models</p>
                    <div className="absolute bg-green-500 py-1 px-2 rounded-lg top-1 right-1">
                      <span className="text-sm text-green-800 font-semibold">
                        Complete
                      </span>
                    </div>
                  </div>
                </div>
                <div className="dark:bg-[#27272A]/50 bg-[#F4F4F5]/50 border border-gray-300 dark:border-none py-2 px-4 rounded-md relative">
                  <div className="flex gap-x-2 items-center">
                    <p>/threads</p>
                    <div className="absolute bg-yellow-500 py-1 px-2 rounded-lg top-1 right-1">
                      <span className="text-sm text-yellow-800 font-semibold">
                        Partial
                      </span>
                    </div>
                  </div>
                </div>
                <div className="dark:bg-[#27272A]/50 bg-[#F4F4F5]/50 border border-gray-300 dark:border-none py-2 px-4 rounded-md relative">
                  <div className="flex gap-x-2 items-center">
                    <p>/messages</p>
                    <div className="absolute bg-yellow-500 py-1 px-2 rounded-lg top-1 right-1">
                      <span className="text-sm text-yellow-800 font-semibold">
                        Partial
                      </span>
                    </div>
                  </div>
                </div>
                <div className="dark:bg-[#27272A]/50 bg-[#F4F4F5]/50 border border-gray-300 dark:border-none py-2 px-4 rounded-md relative">
                  <div className="flex gap-x-2 items-center">
                    <p>/runs</p>
                    <div className="absolute bg-yellow-500 py-1 px-2 rounded-lg top-1 right-1">
                      <span className="text-sm text-yellow-800 font-semibold">
                        Partial
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div> */}
        </main>
      </Layout>
    </>
  );
}
