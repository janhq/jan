import React from "react";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import {
  HomepageFeatures,
  HomepageHero,
  HomepageBanner,
  HomepageUseCases,
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
      {/* <HomepageBanner /> */}
      <main className={styles.main}>
        <HomepageHero />
        <HomepageFeatures />
        <HomepageUseCases />
        <HomepageDownloads />
      </main>
    </Layout>
  );
}
