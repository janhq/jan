import React from "react";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import {
  HomepageHero,
  HomepageBanner,
  HomepageSectionOne,
  HomepageSectionTwo,
  HomepageSectionThree,
  HomepageDownloads,
} from "@site/src/components/Homepage";

import styles from "./index.module.css";

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.tagline}`}
      description="Description will go into a meta tag in <head />"
    >
      <HomepageBanner />
      <main className={styles.main}>
        <HomepageHero />
        <HomepageSectionOne />
        <HomepageSectionTwo />
        {/* <HomepageSectionThree />
        <HomepageDownloads /> */}
      </main>
    </Layout>
  );
}
