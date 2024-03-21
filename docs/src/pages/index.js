import React, { useState } from 'react'

import { useForm } from 'react-hook-form'

import useBaseUrl from '@docusaurus/useBaseUrl'
import Layout from '@theme/Layout'
import Banner from '@site/src/containers/Banner'

import ThemedImage from '@theme/ThemedImage'

import { BsArrowRight } from 'react-icons/bs'

import { IoMapOutline } from 'react-icons/io5'
import { useAppStars } from '@site/src/hooks/useAppStars'
import { useDiscordWidget } from '@site/src/hooks/useDiscordWidget'
import { FaGithub, FaDiscord } from 'react-icons/fa'
import { RiStarSFill } from 'react-icons/ri'

import Dropdown from '@site/src/containers/Elements/dropdown'

import useIsBrowser from '@docusaurus/useIsBrowser'

import useDocusaurusContext from '@docusaurus/useDocusaurusContext'

import { twMerge } from 'tailwind-merge'

import Testimonial from '@site/src/containers/Testimonial'

const table = {
  labels: [
    'Ownership',
    'Openness',
    'Your Role',
    'Approach',
    'Data Handling',
    'Privacy',
    'Transparency',
    'Outage Resilience',
    'Philosophy',
  ],
  statusQuo: [
    'Owned by Big Tech',
    'Closed-source',
    'Consumer',
    'Cloud-based',
    'Stored on external servers',
    'Questionable',
    'Opaque "Black Box',
    'Potential data hostage',
    'User monetization',
  ],
  jan: [
    'Fully owned by you',
    'Open-source (AGPLv3)',
    'Creator',
    'Local-first',
    'Stored locally, openly accessible',
    'Private and offline',
    'Open-source and customizable',
    'Continues to work on your device',
    'Empower users with the right to repair',
  ],
}

const features = [
  {
    title: 'Run local AI or connect to remote APIs',
    description:
      'Choose between running AI models locally for privacy, like Llama or Mistral, or connect to remote APIs, like ChatGPT or Claude.',
  },
  {
    title: 'Browse and download models',
    description: `With Jan's Hub, instantly download popular AI models or import your own to expand your toolkit without hassle.`,
  },
  {
    title: 'Use Jan in your natural workflows',
    description: `Jan works with your workflow, ready to assist at a moment's notice without interrupting your work.`,
  },
  {
    title: 'Customize and add features with Extensions',
    description: `Tailor Jan exactly to your needs with Extensions, making your experience truly your own.`,
  },
]

export default function Home() {
  const isBrowser = useIsBrowser()
  const { stargazers } = useAppStars()
  const { data } = useDiscordWidget()
  const [formMessage, setFormMessage] = useState('')

  const userAgent = isBrowser && navigator.userAgent
  const isBrowserChrome = isBrowser && userAgent.includes('Chrome')

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      email: '',
    },
  })

  const {
    siteConfig: { customFields },
  } = useDocusaurusContext()

  const onSubmit = (data) => {
    const { email } = data
    const options = {
      method: 'POST',
      body: JSON.stringify({
        updateEnabled: false,
        email,
        listIds: [12],
      }),
    }

    if (email) {
      fetch('https://brevo.jan.ai/', options)
        .then((response) => response.json())
        .then((response) => {
          if (response.id) {
            setFormMessage('You have successfully joined our newsletter')
          } else {
            setFormMessage(response.message)
          }
          reset()
          setTimeout(() => {
            setFormMessage('')
          }, 5000)
        })
        .catch((err) => console.error(err))
    }
  }

  const [activeFeature, setActiveFeature] = useState(0)

  // useEffect(() => {
  //   if (activeFeature < 3) {
  //     setTimeout(() => {
  //       setActiveFeature(activeFeature + 1)
  //     }, 5000)
  //   }
  //   if (activeFeature === 3) {
  //     setTimeout(() => {
  //       setActiveFeature(0)
  //     }, 5000)
  //   }
  // }, [activeFeature])

  return (
    <>
      <Banner />
      <Layout
        description="Jan turns your computer into an AI machine by running LLMs locally on your computer. It's a privacy-focus, local-first, open-source solution."
      >
        <main>
          {/* Hero */}
          <div className="text-center px-4 py-16">
            <h1 className="text-6xl lg:text-8xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
              Rethink the Computer
            </h1>
            <p className="text-2xl -mt-1 leading-relaxed text-black/60 dark:text-white/60">
              Turn your computer into an AI machine
            </p>
            <div className="mt-10">
              {!isBrowserChrome ? (
                <a
                  href="/download"
                  className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white scroll-smooth"
                >
                  <span>Download Jan for PC</span>
                </a>
              ) : (
                <Dropdown />
              )}
            </div>
            <p className="mt-6 text-black/60 dark:text-white/60">
              500K+ Downloads | Free & Open Source
            </p>

            <div className="w-4/5  mx-auto mt-10">
              <ThemedImage
                className="object-cover w-full object-center mx-auto h-full lg:-left-4 relative"
                alt="App screenshots"
                sources={{
                  light: useBaseUrl('/img/homepage/app-frame-light.webp'),
                  dark: useBaseUrl('/img/homepage/app-frame-dark.webp'),
                }}
              />
            </div>
          </div>

          {/* Build with Love */}
          <div className="w-full px-4 xl:w-3/5 mx-auto relative py-8">
            <div className="text-center">
              <h1 className="text-5xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                Built with love
              </h1>
              <p className="leading-relaxed text-black/60 dark:text-white/60">
                Jan is entirely open-source. We build it transparently, guided
                by the belief <br className="hidden lg:block" /> that AI's
                future should be open and shared with everyone.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
              <a
                href="https://github.com/janhq/jan"
                target="_blank"
                className="card-wrapper dark:card-wrapper-dark p-4 inline-flex px-4 py-3 rounded-lg cursor-pointer justify-center items-start space-x-4 min-h-28"
              >
                <span>
                  <FaGithub className="text-3xl" />
                </span>
                <div className="flex-col">
                  <div className="flex items-center gap-2">
                    <h6 className="text-base">Github</h6>
                    <div className="text-sm text-black/60 dark:text-white/60 flex items-center space-x-1 py-1 px-2 rounded-md bg-[#E9E9E9] dark:bg-[#484748]">
                      <RiStarSFill className="text-lg text-[#CA8A04]" />
                      <span className="font-semibold">
                        {stargazers.count} stars
                      </span>
                    </div>
                  </div>
                  <p className="text-sm mt-1">
                    Jan is entirely open source and free to use.
                  </p>
                </div>
              </a>
              <a
                href="https://discord.gg/FTk2MvZwJH"
                target="_blank"
                className="card-wrapper dark:card-wrapper-dark p-4 inline-flex px-4 py-3 rounded-lg cursor-pointer justify-center items-start space-x-4 min-h-28"
              >
                <span>
                  <FaDiscord className="text-3xl" />
                </span>
                <div className="flex-col">
                  <div className="flex items-center gap-2">
                    <h6 className="text-base">Discord</h6>
                    <div className="text-sm text-black/60 dark:text-white/60 flex items-center space-x-1 py-1 px-2 rounded-md bg-[#E9E9E9] dark:bg-[#484748]">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="font-semibold">
                        {data.presence_count} online
                      </span>
                    </div>
                  </div>
                  <p className="text-sm mt-1">
                    Join the community to ask questions, get help and learn
                    more.
                  </p>
                </div>
              </a>
              <a
                href="https://github.com/orgs/janhq/projects/5/views/16"
                target="_blank"
                className="card-wrapper dark:card-wrapper-dark p-4 inline-flex px-4 py-3 rounded-lg cursor-pointer justify-center items-start space-x-4 min-h-28"
              >
                <span>
                  <IoMapOutline className="text-3xl" />
                </span>
                <div className="flex-col">
                  <div className="flex items-center gap-2">
                    <h6 className="text-base">Roadmap</h6>
                  </div>
                  <p className="text-sm mt-1">
                    We build in public. See where we're headed!
                  </p>
                </div>
              </a>
            </div>
          </div>

          {/* Wall of love */}
          <Testimonial />

          {/* Feature */}
          <div className="w-full xl:w-10/12 mx-auto relative py-8 lg:pt-24">
            <div className="flex p-4 lg:px-0 lg:justify-between flex-col lg:flex-row items-end">
              <div className="w-full">
                <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                  Jan redefines <br className="hidden lg:block" /> how we use
                  computers
                </h1>
              </div>
              <div className="mt-10 w-full lg:w-1/2 mr-auto lg:text-right">
                <a
                  className="mt-6 text-blue-600 dark:text-blue-400 cursor-pointer"
                  href="https://jan.ai/features/"
                  target="_blank"
                >
                  View Our Features <BsArrowRight className="inline-block" />
                </a>
              </div>
            </div>

            <div className="flex lg:flex-row flex-col items-start gap-8 mt-10">
              <div className="w-full lg:w-2/5 px-4 lg:p-0">
                {features.map((feature, i) => {
                  const isActive = activeFeature === i
                  return (
                    <div
                      key={i}
                      className="mb-4 dark:bg-[#1F1F1F] bg-[#F5F5F5] p-6 rounded-xl cursor-pointer"
                      onClick={() => setActiveFeature(i)}
                    >
                      <div
                        className={twMerge(
                          'flex items-center gap-4',
                          isActive && 'items-start'
                        )}
                      >
                        <h1 className="dark:text-[#4C4C4C] text-[#C4C4C4] text-[32px]">
                          0{i + 1}
                        </h1>
                        <div>
                          <h6 className="text-xl">{feature.title}</h6>
                          <p
                            className={twMerge(
                              'mt-1 leading-relaxed text-black/60 dark:text-white/60 hidden',
                              isActive && 'block'
                            )}
                          >
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="relative w-full -right-[10%] rounded-l-3xl overflow-hidden hidden lg:block">
                {activeFeature === 0 && (
                  <ThemedImage
                    alt="App screenshots"
                    sources={{
                      light: useBaseUrl('/img/homepage/features01.webp'),
                      dark: useBaseUrl('/img/homepage/features01dark.webp'),
                    }}
                  />
                )}
                {activeFeature === 1 && (
                  <ThemedImage
                    alt="App screenshots"
                    sources={{
                      light: useBaseUrl('/img/homepage/features02.webp'),
                      dark: useBaseUrl('/img/homepage/features02dark.webp'),
                    }}
                  />
                )}
                {activeFeature === 2 && (
                  <ThemedImage
                    alt="App screenshots"
                    sources={{
                      light: useBaseUrl('/img/homepage/features03.webp'),
                      dark: useBaseUrl('/img/homepage/features03dark.webp'),
                    }}
                  />
                )}
                {activeFeature === 3 && (
                  <ThemedImage
                    alt="App screenshots"
                    sources={{
                      light: useBaseUrl('/img/homepage/features04.webp'),
                      dark: useBaseUrl('/img/homepage/features04dark.webp'),
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Philosophy */}
          <div className="px-4 lg:px-8 mt-10 lg:mt-20 border-y border-[#F0F0F0] dark:border-gray-800">
            <div className="w-full xl:w-3/4 mx-auto relative pt-8 text-center">
              <h1 className="text-5xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                Our Philosophy
              </h1>
              <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60 flex gap-x-2 justify-center">
                Jan is opinionated software on what AI should be{' '}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10.5 0H15V1.5H13.5V3H18V4.5H16.5V6H15V7.5H13.5V9H12V10.5H13.5V12H15V13.5H10.5V16.5H9V12H7.5V10.5H6V9H7.5V7.5H9V6H10.5V4.5H12V1.5H10.5V0Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M21 0H22.5V1.5H21V0Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M9 1.5H10.5V4.5H9V1.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M18 1.5H21V3H18V1.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M4.5 10.5H6V12H4.5V10.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M3 12H4.5V13.5H3V12Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M0 13.5H3V15H0V13.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M15 13.5H16.5V15H21V16.5H15V13.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M7.5 16.5H9V18H12V19.5H7.5V21H3V19.5H6V18H7.5V16.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M12 16.5H15V18H12V16.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M21 16.5H22.5V18H21V16.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M15 18H16.5V19.5H15V18Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M19.5 18H21V19.5H19.5V18Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M16.5 19.5H19.5V21H16.5V19.5Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M1.5 21H3V22.5H1.5V21Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M7.5 21H9V22.5H12V24H3V22.5H7.5V21Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M12 21H16.5V22.5H12V21Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                </svg>
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-left mt-16">
                <div>
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 32 32"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M28.96 13.72V9.14H27.43V10.67H24.39V7.62H25.91V6.1H22.86V3.05H21.34V0H4.58V1.52H1.53V13.72H0V32H32V13.72H28.96ZM22.86 7.62V12.19H27.43V13.72H15.24V7.62H22.86ZM3.05 3.05H4.58V13.72H3.05V3.05ZM9.15 18.29H7.62V19.81H4.58V18.29H3.05V16.76H9.15V18.29ZM9.15 13.72H6.1V1.52H19.81V3.05H9.15V13.72ZM10.67 4.57H21.34V6.1H13.72V13.72H10.67V4.57ZM30.48 30.48H12.2V15.24H30.48V30.48Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M28.9601 22.86H27.4301V24.38H28.9601V22.86Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M28.9601 27.43H19.8101V28.95H28.9601V27.43Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M27.43 7.62H25.91V9.14H27.43V7.62Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M25.91 24.38H22.86V25.91H25.91V24.38Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M21.3401 22.86H19.8101V24.38H21.3401V22.86Z"
                      fill="#4377E9"
                    />
                  </svg>
                  <h5 className="mt-4 mb-2">Local-first</h5>
                  <p className="text-black/60 dark:text-white/60">
                    We believe your conversations and files should remain yours
                    alone. That's why we prioritize local-first AI, running
                    open-source models directly on your computer.
                  </p>
                </div>
                <div>
                  <svg
                    width="29"
                    height="32"
                    viewBox="0 0 29 32"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M28.9495 22.8602H24.3795V21.3302H25.8995V19.8103H3.04994V21.3302H4.57491V22.8602H0V32H28.9495V22.8602ZM6.08989 21.3302H22.8496V22.8602H6.08989V21.3302ZM27.4295 30.4801H1.51997V24.3802H27.4295V30.4801Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M27.4294 1.52042H25.8994V19.8101H27.4294V1.52042Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M24.3795 25.8996H16.7596V27.4296H24.3795V25.8996Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M18.2796 10.6697H16.7596V12.1897H18.2796V10.6697Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M18.2796 7.62H16.7596V9.13997H18.2796V7.62Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M16.7596 12.1889H12.1897V13.7089H16.7596V12.1889Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M12.1896 10.6697H10.6597V12.1897H12.1896V10.6697Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M12.1896 7.62H10.6597V9.13997H12.1896V7.62Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M4.57483 18.2895H24.3845V3.04974H4.57483V18.2895ZM6.0898 4.56972H22.8495V16.7595H6.0898V4.56972Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M7.61977 25.8996H4.56982V28.9495H7.61977V25.8996Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M25.8995 0H3.04993V1.51997H25.8995V0Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M3.04987 1.52042H1.5199V19.8101H3.04987V1.52042Z"
                      fill="#4377E9"
                    />
                  </svg>
                  <h5 className="mt-4 mb-2">User-owned</h5>
                  <p className="text-black/60 dark:text-white/60">
                    Your data, your rules. Jan stores everything on your device
                    in universal formats, giving you total freedom to move your
                    data without tricks or traps.
                  </p>
                </div>
                <div>
                  <svg
                    width="28"
                    height="32"
                    viewBox="0 0 28 32"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M27.715 9.90503H26.185V28.195H27.715V9.90503Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M26.185 28.195H24.665V29.715H26.185V28.195Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M26.185 8.38501H24.665V9.90501H26.185V8.38501Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M24.665 29.715H3.33496V31.235H24.665V29.715Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M24.665 6.85501H18.565V8.38501H24.665V6.85501Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M18.565 3.80502H17.045V6.85502H18.565V3.80502Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M17.045 2.285H15.525V3.805H17.045V2.285Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M15.525 0.765015H12.475V2.28501H15.525V0.765015Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M12.4749 2.285H10.9449V3.805H12.4749V2.285Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M10.945 3.80502H9.42499V6.85502H10.945V3.80502Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M7.905 17.525H6.375V20.575H7.905V17.525Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M6.37498 20.575H4.85498V22.095H6.37498V20.575Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M6.37498 15.995H4.85498V17.525H6.37498V15.995Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M9.42496 6.85501H3.33496V8.38501H9.42496V6.85501Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M1.80497 14.475V9.90503H0.284973V15.995H4.85497V14.475H1.80497Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M3.33499 28.195H1.80499V29.715H3.33499V28.195Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M3.33499 8.38501H1.80499V9.90501H3.33499V8.38501Z"
                      fill="#4377E9"
                    />
                    <path
                      d="M1.80497 23.615H4.85497V22.095H0.284973V28.195H1.80497V23.615Z"
                      fill="#4377E9"
                    />
                  </svg>

                  <h5 className="mt-4 mb-2">Fully Customizable</h5>
                  <p className="text-black/60 dark:text-white/60">
                    You can endlessly customize the experience with 3rd party
                    extensions. You can adjust alignment, moderation, and
                    censorship levels to your needs.
                  </p>
                </div>
              </div>

              <div className="mt-20 flex dark:bg-[#181818] bg-[#FAFAFA] border border-gray-300 dark:border-gray-600 rounded-t-2xl border-b-0">
                <div className="w-56 lg:w-80 border-r border-gray-300 dark:border-gray-600">
                  <div className="h-[52px]"></div>
                  {table.labels.map((label, i) => {
                    return (
                      <div
                        className="border-t border-gray-300 dark:border-gray-600 p-4 font-bold text-left"
                        title={label}
                        key={i}
                      >
                        <h6 className="line-clamp-1 my-[2px]">{label}</h6>
                      </div>
                    )
                  })}
                </div>

                <div className="w-full lg:w-1/2 border-r border-gray-300 dark:border-gray-600 hidden md:block">
                  <h6 className="p-4 mb-0">Status Quo</h6>
                  {table.statusQuo.map((label, i) => {
                    return (
                      <div
                        className="border-t border-gray-300 dark:border-gray-600 p-4"
                        key={i}
                        title={label}
                      >
                        <p className="text-black/60 dark:text-white/60 line-clamp-1">
                          {label}
                        </p>
                      </div>
                    )
                  })}
                </div>
                <div className="w-full lg:w-1/2">
                  <div className="flex p-4 items-center gap-x-2 justify-center">
                    <img
                      src="img/logo.svg"
                      alt="logo-mark"
                      width={20}
                      height={20}
                    />
                    <h6 className="mb-0">Jan</h6>
                  </div>
                  {table.jan.map((label, i) => {
                    return (
                      <div
                        className="border-t border-gray-300 dark:border-gray-600 p-4"
                        key={i}
                        title={label}
                      >
                        <p className="text-black/60 dark:text-white/60 line-clamp-1">
                          {label}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* CTA email newsletter */}
          <div className="bg-[#F0F0F0] dark:bg-[#242424] text-center py-16">
            <div className="w-full xl:w-10/12 mx-auto relative">
              <div className="flex p-4 lg:justify-between flex-col lg:flex-row items-end">
                <div className="w-full">
                  <ThemedImage
                    className="w-28 mx-auto h-auto"
                    alt="App screenshots"
                    sources={{
                      light: useBaseUrl('/img/homepage/mac-system-black.svg'),
                      dark: useBaseUrl('/img/homepage/mac-system-white.svg'),
                    }}
                  />
                  <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                    The Soul of a New Machine
                  </h1>
                  <p className="leading-relaxed text-black/60 dark:text-white/60">
                    Follow our AI research and journey in building Jan
                  </p>

                  <div className="w-full lg:w-1/2 mt-8 mx-auto">
                    <form
                      className="relative"
                      onSubmit={handleSubmit(onSubmit)}
                    >
                      <input
                        type="email"
                        className="w-full h-16 p-4 pr-14 rounded-xl border border-[#F0F0F0] dark:bg-white/10 dark:border-gray-600"
                        placeholder="Enter your email"
                        {...register('email')}
                      />
                      <button
                        type="submit"
                        className="absolute flex p-2 px-4 items-center dark:text-black bg-black text-white dark:bg-white h-12 border border-gray-600 rounded-lg top-1/2 right-3 -translate-y-1/2 font-medium"
                      >
                        Subscribe
                      </button>
                    </form>
                    {formMessage && (
                      <p className="text-left mt-4">{formMessage}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Location and statistic */}
          <div className="lg:w-4/5 w-full px-4 mx-auto py-10 lg:pb-20 lg:pt-32">
            <div className="w-full lg:w-3/4 mx-auto pb-20">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center">
                  <h1>13</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Core team
                  </p>
                </div>
                <div className="text-center">
                  <h1>39+</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Contributors
                  </p>
                </div>
                <div className="text-center">
                  <h1>2416+</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Pull Requests
                  </p>
                </div>
                <div className="text-center">
                  <h1>500K+</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Downloads
                  </p>
                </div>
              </div>
            </div>
            <ThemedImage
              className="w-full mx-auto h-auto"
              alt="App screenshots"
              sources={{
                light: useBaseUrl('/img/homepage/mapbase-light.webp'),
                dark: useBaseUrl('/img/homepage/mapbase.webp'),
              }}
            />
          </div>

          {/* CTA Bottom */}
          <div className="w-full xl:w-10/12 mx-auto relative py-8">
            <div className="flex p-4 lg:justify-between flex-col lg:flex-row">
              <div className="w-full">
                <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                  Change how <br className="hidden lg:block" /> you use
                  computers
                </h1>
              </div>
              <div className="mt-10 w-full lg:w-1/2 mx-auto lg:mr-auto lg:text-right">
                {!isBrowserChrome ? (
                  <a
                    href="/download"
                    className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white scroll-smooth"
                  >
                    <span>Download Jan for PC</span>
                  </a>
                ) : (
                  <Dropdown />
                )}
                <p className="mt-6 text-zinc-text-black/60 dark:text-white/60">
                  500K+ Downloads | Free & Open Source
                </p>
              </div>
            </div>
          </div>
        </main>
      </Layout>
    </>
  )
}
