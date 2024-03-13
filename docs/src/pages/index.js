import React from 'react'
import DownloadApp from '@site/src/containers/DownloadApp'
import { Tweet } from 'react-tweet'
import { useForm } from 'react-hook-form'

import useBaseUrl from '@docusaurus/useBaseUrl'
import Layout from '@theme/Layout'
import Banner from '@site/src/containers/Banner'

import ThemedImage from '@theme/ThemedImage'

import { IoArrowDown } from 'react-icons/io5'
import { IoMapOutline } from 'react-icons/io5'
import { useAppStars } from '@site/src/hooks/useAppStars'
import { useDiscordWidget } from '@site/src/hooks/useDiscordWidget'
import { FaGithub, FaDiscord } from 'react-icons/fa'
import { RiStarSFill } from 'react-icons/ri'

import Dropdown from '@site/src/containers/Elements/dropdown'

import useIsBrowser from '@docusaurus/useIsBrowser'

export default function Home() {
  const isBrowser = useIsBrowser()
  const { stargazers } = useAppStars()
  const { data } = useDiscordWidget()

  const handleAnchorLink = () => {
    document
      .getElementById('download-section')
      .scrollIntoView({ behavior: 'smooth' })
  }

  const userAgent = isBrowser && navigator.userAgent
  const isBrowserChrome = isBrowser && userAgent.includes('Chrome')

  const { register, handleSubmit } = useForm({
    defaultValues: {
      email: '',
    },
  })

  const onSubmit = (data) => {
    const { email } = data
    const options = {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.API_KEY_BREVO,
      },
      body: JSON.stringify({
        updateEnabled: false,
        email,
        listIds: [12],
      }),
    }

    if (email) {
      fetch('https://api.brevo.com/v3/contacts', options)
        .then((response) => response.json())
        .catch((err) => console.error(err))
    }
  }

  return (
    <>
      <Banner />
      <Layout
        title="Open-source ChatGPT Alternative"
        description="Jan runs 100% offline on your computer, utilizes open-source AI models, prioritizes privacy, and is highly customizable."
      >
        <main>
          {/* Hero */}
          <div className="text-center py-16">
            <h1 className="text-5xl lg:text-8xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
              Rethink the Computer
            </h1>
            <p className="text-2xl -mt-1 leading-relaxed text-black/60 dark:text-white/60">
              Turn your computer into an{' '}
              <span className="text-black dark:text-white font-semibold">
                AI machine
              </span>
            </p>
            <div className="mt-10">
              {!isBrowserChrome ? (
                <div
                  onClick={() => handleAnchorLink()}
                  className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white scroll-smooth"
                >
                  <span>Download Jan for PC</span>
                </div>
              ) : (
                <Dropdown />
              )}
            </div>
            <p className="mt-6 text-black/60 dark:text-white/60">
              400K+ Downloads | Free & Open Source
            </p>

            <div className="w-4/5  mx-auto mt-10">
              <ThemedImage
                className="object-cover w-full object-center mx-auto h-full lg:-left-4 relative"
                alt="App screenshots"
                sources={{
                  light: useBaseUrl('/img/homepage/app-frame-light.png'),
                  dark: useBaseUrl('/img/homepage/app-frame-dark.png'),
                }}
              />
            </div>
          </div>

          {/* Build with Love */}
          <div className="w-full xl:w-3/5 mx-auto relative py-8">
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
                className="card-wrapper dark:card-wrapper-dark p-4 inline-flex px-4 py-3 rounded-lg cursor-pointer justify-center items-start space-x-4 "
              >
                <span>
                  <FaGithub className="text-3xl" />
                </span>
                <div className="flex-col">
                  <div className="flex items-center gap-2">
                    <h6 className="text-base">Github</h6>
                    <div className="text-sm text-black dark:text-white flex items-center space-x-1 py-1 px-2 rounded-md bg-[#E9E9E9] dark:bg-[#484748]">
                      <RiStarSFill className="text-lg text-[#FEC928]" />
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
                className="card-wrapper dark:card-wrapper-dark p-4 inline-flex px-4 py-3 rounded-lg cursor-pointer justify-center items-start space-x-4 "
              >
                <span>
                  <FaDiscord className="text-3xl" />
                </span>
                <div className="flex-col">
                  <div className="flex items-center gap-2">
                    <h6 className="text-base">Discord</h6>
                    <div className="text-sm text-black dark:text-white flex items-center space-x-1 py-1 px-2 rounded-md bg-[#E9E9E9] dark:bg-[#484748]">
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
                className="card-wrapper dark:card-wrapper-dark p-4 inline-flex px-4 py-3 rounded-lg cursor-pointer justify-center items-start space-x-4 "
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
          <div className="bg-[#F0F0F0] dark:bg-[#242424] p-8 mt-20">
            <div className="w-full xl:w-3/5 mx-auto relative py-8 text-center">
              <h1 className="text-5xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                People say nice things
              </h1>
              <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60">
                ...despite our bugs and fast moving releases
              </p>
            </div>
          </div>

          {/* Feature */}
          <div className="w-full xl:w-10/12 mx-auto relative py-8">
            <div className="flex p-4 lg:justify-between flex-col lg:flex-row items-end">
              <div className="w-full">
                <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                  Jan redefines <br className="hidden lg:block" /> how we use
                  computers
                </h1>
              </div>
              <div className="mt-10 w-full lg:w-1/2 mr-auto text-right">
                <p className="mt-6 text-blue-600 dark:text-blue-400">
                  View Our Features
                </p>
              </div>
            </div>
          </div>

          {/* Philosophy */}
          <div className="p-8 mt-20 border-y border-gray-300 dark:border-gray-800">
            <div className="w-full xl:w-3/4 mx-auto relative py-8 text-center">
              <h1 className="text-5xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                Our Philosophy
              </h1>
              <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60">
                Jan is opinionated software on what AI should be
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
                      light: useBaseUrl('/img/homepage/mac-system-black.png'),
                      dark: useBaseUrl('/img/homepage/mac-system-white.png'),
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
                        className="w-full h-16 p-4 pr-14 rounded-xl border border-gray-600 dark:bg-white/10"
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
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Location and statistic */}
          <div className="lg:w-4/5 w-full px-4 mx-auto py-10 lg:pb-20 lg:pt-32">
            <div className="w-full lg:w-1/2 mx-auto pb-20">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center">
                  <h1>13</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Core team
                  </p>
                </div>
                <div className="text-center">
                  <h1>32+</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Contributors
                  </p>
                </div>
                <div className="text-center">
                  <h1>1722+</h1>
                  <p className="font-medium text-black/60 dark:text-white/60">
                    Pull Requests
                  </p>
                </div>
                <div className="text-center">
                  <h1>400K+</h1>
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
                light: useBaseUrl('/img/homepage/mapbase-light.png'),
                dark: useBaseUrl('/img/homepage/mapbase.png'),
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
                  <div
                    onClick={() => handleAnchorLink()}
                    className="inline-flex px-4 py-3 rounded-lg text-lg font-semibold cursor-pointer justify-center items-center space-x-2 dark:bg-white dark:text-black bg-black text-white dark:hover:text-black hover:text-white scroll-smooth"
                  >
                    <span>Download Jan for PC</span>
                  </div>
                ) : (
                  <Dropdown />
                )}
                <p className="mt-6 text-zinc-text-black/60 dark:text-white/60">
                  400K+ Downloads | Free & Open Source
                </p>
              </div>
            </div>
          </div>
        </main>
      </Layout>
    </>
  )
}
