import clsx from 'clsx'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import styles from './docs.module.css'
import HomepagePrimaryFeatures from '../components/HomepagePrimaryFeatures'
import HomepageSecondaryFeatures from '../components/HomepageSecondaryFeatures'
import HomepageTerinaryFeatures from '../components/HomepageTerinaryFeatures'
import { DocSearch } from '@docsearch/react'
import NavbarExtended from '../theme/NavbarExtension'

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext()

  return (
    <header className={clsx(styles.heroBanner)}>
      <NavbarExtended />
      <div className="container">
        <Heading as="h1" className={clsx(styles.heroTitle)}>
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
      title={`Docs`}
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
