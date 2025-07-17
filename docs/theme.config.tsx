import React, { Fragment } from 'react'
import { useConfig, DocsThemeConfig } from 'nextra-theme-docs'
import LogoMark from '@/components/LogoMark'
import FooterMenu from '@/components/FooterMenu'
import JSONLD from '@/components/JSONLD'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { LibraryBig, Blocks, BrainCircuit, Computer } from 'lucide-react'
import { AiOutlineGithub } from 'react-icons/ai'
import { BiLogoDiscordAlt } from 'react-icons/bi'
import { RiTwitterXFill } from 'react-icons/ri'

const defaultUrl = 'https://jan.ai'
const defaultImage = 'https://jan.ai/assets/images/general/og-image.png'

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  'name': 'Jan',
  'url': `${defaultUrl}`,
  'logo': `${defaultImage}`,
}

const config: DocsThemeConfig = {
  logo: (
    <span className="flex gap-x-8 items-center">
      <div className="flex">
        <LogoMark />
        <span className="ml-2 text-lg font-semibold">Jan</span>
      </div>
    </span>
  ),
  docsRepositoryBase: 'https://github.com/menloresearch/jan/tree/dev/docs',
  feedback: {
    content: 'Question? Give us feedback →',
    labels: 'feedback',
  },
  editLink: {
    text: 'Edit this page on GitHub →',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s - Jan',
      twitter: {
        cardType: 'summary_large_image',
        site: '@jandotai',
      },
      openGraph: {
        type: 'website',
      },
    }
  },
  navbar: {
    extraContent: (
      <div className="inline-flex items-center gap-x-2">
        <a href="https://discord.com/invite/FTk2MvZwJH" target="_blank">
          <BiLogoDiscordAlt className="text-xl text-black/60 dark:text-white/60" />
        </a>
        <a href="https://twitter.com/jandotai" target="_blank">
          <RiTwitterXFill className="text-lg text-black/60 dark:text-white/60" />
        </a>
        <a href="https://github.com/menloresearch/jan" target="_blank">
          <AiOutlineGithub className="text-xl text-black/60 dark:text-white/60" />
        </a>

        <Link
          href={'/download'}
          className="hidden md:inline-block mx-2 bg-black dark:bg-white text-white dark:text-black font-medium px-3 py-1 rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors text-sm"
        >
          Download
        </Link>
      </div>
    ),
  },
  sidebar: {
    titleComponent: ({ type, title }) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { asPath } = useRouter()
      if (type === 'separator' && title === 'Switcher') {
        return (
          <div className="-mx-2 hidden md:block">
            {[
              { title: 'Jan', path: '/docs', Icon: LibraryBig },
              {
                title: 'Jan Local Server',
                path: '/local-server',
                Icon: BrainCircuit,
              },
              // { title: 'Jan Mobile', path: '/platforms', Icon: Blocks },
              {
                title: 'Jan API Platform',
                path: '/platforms',
                Icon: Computer,
              },
            ].map((item) =>
              asPath.startsWith(item.path) ? (
                <div
                  key={item.path}
                  className="group mb-3 flex flex-row items-center gap-3 nx-text-primary-800 dark:nx-text-primary-600"
                >
                  <item.Icon className="w-7 h-7 p-1 border  border-gray-200 dark:border-gray-700 rounded nx-bg-primary-100 dark:nx-bg-primary-400/10" />
                  {item.title}
                </div>
              ) : (
                <Link
                  href={item.path}
                  key={item.path}
                  className="group mb-3 flex flex-row items-center gap-3 text-gray-500 hover:text-primary/100"
                >
                  <item.Icon className="w-7 h-7 p-1 border rounded border-gray-200 dark:border-gray-700" />
                  {item.title}
                </Link>
              )
            )}
          </div>
        )
      }
      return title
    },
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },

  head: function useHead() {
    const { title, frontMatter } = useConfig()
    const titleTemplate = (frontMatter?.title || title) + ' - ' + 'Jan'
    const { asPath } = useRouter()

    return (
      <Fragment>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Language" content="en" />
        <title>{titleTemplate}</title>
        <meta name="og:title" content={titleTemplate} />
        <meta
          name="description"
          content={
            frontMatter?.description ||
            `Run LLMs like Qwen3 or Llama3 locally and offline on your computer, or connect to remote AI APIs like OpenAI's GPT-4 or Groq.`
          }
        />
        <meta
          name="og:description"
          content={
            frontMatter?.description ||
            `Run LLMs like Qwen3 or Llama3 locally and offline on your computer, or connect to remote AI APIs like OpenAI's GPT-4 or Groq.`
          }
        />
        <link
          rel="canonical"
          href={frontMatter?.ogImage ? 'https://jan.ai' + asPath : defaultUrl}
        />
        <meta
          property="og:url"
          content={
            frontMatter?.ogImage ? 'https://jan.ai' + asPath : defaultUrl
          }
        />
        <meta
          property="og:image"
          content={
            frontMatter?.ogImage
              ? 'https://jan.ai/' + frontMatter?.ogImage
              : 'https://jan.ai/assets/images/general/og-image.png'
          }
        />
        <meta property="og:image:alt" content="Jan-OGImage" />
        <meta
          name="keywords"
          content={
            frontMatter?.keywords?.map((keyword: string) => keyword) || [
              'Jan',
              'Customizable Intelligence, LLM',
              'local AI',
              'privacy focus',
              'free and open source',
              'private and offline',
              'conversational AI',
              'no-subscription fee',
              'large language models',
              'build in public',
              'remote team',
              'how we work',
            ]
          }
        />
        <JSONLD data={structuredData} />
      </Fragment>
    )
  },
  footer: {
    text: <FooterMenu />,
  },
  nextThemes: {
    defaultTheme: 'light',
  },
}

export default config
