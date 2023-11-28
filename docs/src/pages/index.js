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
            <div className="grid grid-cols-1 lg:grid-cols-12 mt-8 gap-8 items-center relative">
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
                    className="rounded-md shadow-2xl dark:shadow-none w-full lg:w-4/5"
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

          <div className="bg-gray-100 dark:bg-[#09090B]/20 border-y border-gray-300 dark:border-gray-800 mt-10 py-10">
            <div className="container">
              <div className="w-full lg:w-3/4 mx-auto">
                <DownloadApp />
              </div>
            </div>
          </div>

          <div className="container text-center mt-20">
            <h5>Take Control</h5>
            <p>
              Jan runs 100% on your own machine, privately, predictably and even
              in offline, with no surprise bills
            </p>
          </div>

          <div className="container text-center mt-20">
            <h5>100% Open Source</h5>
            <p>
              Say goodbye to black boxes. Jan has well-documented code and
              stores data in open-format files that you can inspect, verify and
              tinker with.
            </p>
          </div>

          <div className="container text-center mt-20">
            <h5>Extensions</h5>
            <p>
              Jan has a powerful Extensions API inspired by VSCode. In fact,
              most of Jan's core services are built as extensions.
            </p>
          </div>

          <div className="container text-center my-20">
            <h5>No-fuss Compatibility</h5>
            <p>
              Jan's API aims to be a drop-in replacement for OpenAI's REST API,
              with a local server that runs at port 1337
            </p>
          </div>
        </main>
      </Layout>
    </>
  );
}
