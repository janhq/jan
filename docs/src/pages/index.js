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
      {/* <AnnoncementBanner /> */}
      <Layout
        title={`${siteConfig.tagline}`}
        description="Jan is a ChatGPT-alternative that runs on your own computer, with a local API server."
      >
        <main>
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-12 mt-10 gap-8 items-center">
              <div className="col-span-7">
                <h1 className="bg-gradient-to-b dark:from-white from-black to-gray-700 dark:to-gray-400 bg-clip-text text-7xl font-semibold leading-tight text-transparent dark:text-transparent lg:leading-tight">
                  Own your AI
                </h1>
                <p className="text-2xl mt-1">
                  Jan is an open-source alternative to ChatGPT that runs on your
                  own computer
                </p>
              </div>
              <div className="col-span-5">
                <p>
                  Lorem ipsum, dolor sit amet consectetur adipisicing elit.
                  Error explicabo aperiam molestias neque quod ad id dolorum
                  adipisci dicta magni possimus, tempore temporibus magnam nisi
                  harum veritatis eaque molestiae suscipit.
                </p>
              </div>
            </div>
          </div>
        </main>
      </Layout>
    </>
  );
}
