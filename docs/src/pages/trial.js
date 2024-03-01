import clsx from 'clsx'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import styles from './trial.module.css'
import HomepagePrimaryFeatures from '../components/HomepagePrimaryFeatures'
import HomepageSecondaryFeatures from '../components/HomepageSecondaryFeatures'
import HomepageTerinaryFeatures from '../components/HomepageTerinaryFeatures'
import { DocSearch } from '@docsearch/react'

function HomepageHeader() {
  return (
    <header className={clsx(styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className={clsx(styles.heroTitle)}>
          Hello, how can we help?
        </Heading>
        <div className={styles.searchBar}>
          <DocSearch
            appId={process.env.ALGOLIA_APP_ID}
            apiKey={process.env.ALGOLIA_API_KEY}
            indexName="jan_docs"
          />
        </div>
        {/* <div className={styles.searchBar}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill={"currentColor"}>
                <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg>
            <input placeholder={"Search for questions or topics ..."}/>
            <button>Search</button>
        </div> */}
        <p className={clsx(styles.heroSubtitle)}>
          Open-source ChatGPT alternative that runs 100% offline on your
          computer.
        </p>
      </div>
    </header>
  )
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title={`Home | ${siteConfig.title}`}
      description="Description will go into a meta tag in <head />"
    >
      <div className={clsx(styles.homeBg)}>
        <HomepageHeader />
        <main style={{ backgroundColor: 'whitesmoke' }}>
          <HomepagePrimaryFeatures />
          <HomepageSecondaryFeatures />
          <HomepageTerinaryFeatures />
        </main>
      </div>
    </Layout>
  )
}
