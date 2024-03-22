import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import { DocSearch } from '@docsearch/react';
import HomepagePrimaryFeatures from '../components/HomepagePrimaryFeatures';
import HomepageSecondaryFeatures from '../components/HomepageSecondaryFeatures';
import HomepageTerinaryFeatures from '../components/HomepageTerinaryFeatures';

import styles from './docs.module.css'

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();

  return (
    <header className="bg-white dark:bg-gray-800 py-16 h-[20%] 2xl:h-[80vh] text-center relative overflow-hidden">
      <div className="bg-custom-img w-full h-full absolute top-0 left-0 bg-cover bg-center"></div>
      <div className="container relative z-10">
        <Heading as="h1" className="text-2xl lg:text-3xl xl:text-5xl 2xl:text-7xl font-semibold text-white dark:text-gray-200 mb-8 mt-8 2xl:mt-24 2xl:mb-16">
          Hello, how can we help?
        </Heading>
        <div className={styles.searchBar}>
          <DocSearch
            appId={siteConfig.themeConfig.algolia.appId}
            apiKey={siteConfig.themeConfig.algolia.apiKey}
            indexName={siteConfig.themeConfig.algolia.indexName}
            contextualSearch={true}
            insight={true}
          />
        </div>
        <p className="text-lg md:text-xl xl:text-2xl 2xl:text-4xl text-white dark:text-gray-200 mt-8 xl:mt-12">
          Open-source ChatGPT alternative that runs 100% offline on your computer.
        </p>
      </div>
    </header>

  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Docs"
      description="Description will go into a meta tag in <head />"
    >
      <div className="bg-white dark:bg-gray-800">
        <HomepageHeader />
        <main className="bg-whitesmoke dark:bg-gray-900">
          <HomepagePrimaryFeatures />
          <HomepageSecondaryFeatures />
          <HomepageTerinaryFeatures />
        </main>
      </div>
    </Layout>
  );
}
