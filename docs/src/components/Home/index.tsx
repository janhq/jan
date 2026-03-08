'use client'
/* eslint-disable @next/next/no-img-element */
import { Fragment, useEffect } from 'react'
import { FaDiscord, FaGithub } from 'react-icons/fa'
import HuggingFaceSVG from '@/assets/icons/huggingface.svg'
import CuteRobotBgMountainPNG from '@/assets/landing/cute-robot-bg-mountain.png'
import { Button } from '@/components/ui/button'
import CuteRobotFlyingPNG from '@/assets/landing/cute-robot-flying.png'
import LogoJanSVG from '@/assets/icons/logo-jan.svg'
import AppJanPNG from '@/assets/landing/app-jan.png'
import TweetSection from '@/components/TweetSection'
import FavoriteModels from '@/components/FavoriteModels'
import { DropdownButton } from '@/components/ui/dropdown-button'

import { useData } from 'nextra/data'
import { useDiscordWidget } from '@/hooks/useDiscordWidget'
import { formatCompactNumber, totalDownload } from '@/utils/format'

const Home = () => {
  const { lastVersion, lastRelease, stars, release } = useData()
  const { data: discordWidget } = useDiscordWidget()

  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px',
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const element = entry.target as HTMLElement
          const delay = element.dataset.delay || '0'

          setTimeout(() => {
            element.classList.add('animate-in-view')
          }, parseInt(delay))

          observer.unobserve(element)
        }
      })
    }, observerOptions)

    // Observe all scroll-triggered animation elements
    const animatedElements = document.querySelectorAll(
      '.animate-on-scroll, .animate-on-scroll-left, .animate-on-scroll-right, .animate-on-scroll-scale, .animate-slide-up'
    )

    animatedElements.forEach((element) => {
      observer.observe(element)
    })

    // Simple parallax effect for robot images
    const handleScroll = () => {
      const parallaxElements = document.querySelectorAll('.parallax-element')

      parallaxElements.forEach((el) => {
        const element = el as HTMLElement
        const rect = element.getBoundingClientRect()

        // Only apply parallax when element is visible
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          const speed = parseFloat(element.getAttribute('data-speed') || '0.3')
          // Simple calculation: how far the element has moved into/through viewport
          const progress = Math.min(
            1,
            Math.max(0, (window.innerHeight - rect.top) / window.innerHeight)
          )
          // Move from 0 to -40px based on progress
          const yPos = Math.round(progress * -100 * speed)
          element.style.transform = `translateY(${yPos}px)`
        }
      })
    }

    window.addEventListener('scroll', handleScroll)

    // Cleanup function
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return (
    <Fragment>
      {/* Hero */}
      <section className="px-3 pt-3">
        <div className="bg-[#458edf] relative py-10 h-[760px] md:h-[900px] 2xl:h-[1080px] rounded-2xl overflow-hidden">
          <div className="container mx-auto relative z-10">
            <div className="flex justify-center items-center mt-14 lg:mt-20 px-4">
              <a
                href={`https://github.com/janhq/jan/releases/tag/${lastVersion}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-black/40 px-3 lg:px-4 rounded-full h-10 inline-flex items-center max-w-full animate-fade-in delay-100"
              >
                <span className="bg-black/20 border border-neutral-700 mr-2 -ml-1 rounded-full px-2 text-white font-medium text-xs lg:text-sm">
                  NEW
                </span>
                <span className="text-white text-xs md:text-sm lg:text-base truncate font-medium">
                  ✨ <span className="font-medium">{lastVersion}</span> is now
                  live on GitHub. Check it out!
                </span>
              </a>
            </div>
            <div className="mt-4">
              <div className="text-center relative lg:w-1/2 mx-auto">
                <div className="flex flex-col lg:flex-row items-center justify-center gap-4 animate-fade-in-up delay-300">
                  <span>
                    <img
                      src={LogoJanSVG.src}
                      alt="Logo Jan"
                      className="size-20 animate-wave"
                    />
                  </span>
                  <h1 className="text-[40px] lg:text-[80px] font-semibold -tracking-[2px] text-white">
                    Meet Jan
                  </h1>
                </div>
                <p className="px-4 lg:px-0 mt-2 text-lg lg:text-2xl font-medium leading-relaxed text-white animate-fade-in-up delay-500 -tracking-[0.6px]">
                  Personal Intelligence that answers only to you
                </p>
              </div>
              <div className="flex px-4 flex-col lg:flex-row items-start gap-4 w-full justify-center text-center animate-fade-in-up delay-600 mt-8 lg:mt-10">
                <div className="w-full lg:w-auto">
                  <DropdownButton
                    size="xxl"
                    className="w-full !rounded-[20px] lg:w-auto"
                    lastRelease={lastRelease}
                  />
                  <div className="font-medium text-center mt-2 text-white">
                    +{totalDownload(release)} downloads
                  </div>
                </div>
                <a
                  href="https://discord.com/invite/FTk2MvZwJH"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full lg:w-auto"
                >
                  <Button
                    variant="playful-white"
                    size="xxl"
                    className="!w-full lg:w-auto !items-center border-2"
                  >
                    <FaDiscord className="size-5 text-[#5765F2]" />
                    Join community
                    <div className="flex items-center gap-1 ml-3">
                      <svg
                        width="19"
                        height="18"
                        viewBox="0 0 19 18"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <g clipPath="url(#clip0_1299_2107)">
                          <path
                            d="M3.12524 5.25C3.12524 3.59315 4.46839 2.25 6.12524 2.25C7.7821 2.25 9.12524 3.59315 9.12524 5.25C9.12524 6.90685 7.7821 8.25 6.12524 8.25C4.46839 8.25 3.12524 6.90685 3.12524 5.25Z"
                            fill="black"
                            fillOpacity={1}
                          />
                          <path
                            d="M9.87524 5.25C9.87524 3.59315 11.2184 2.25 12.8752 2.25C14.5321 2.25 15.8752 3.59315 15.8752 5.25C15.8752 6.90685 14.5321 8.25 12.8752 8.25C11.2184 8.25 9.87524 6.90685 9.87524 5.25Z"
                            fill="black"
                            fillOpacity={1}
                          />
                          <path
                            d="M6.12504 9C8.72805 9 11.105 11.1426 11.3732 14.9473L11.4298 15.75H0.820312L0.876899 14.9473C1.14509 11.1426 3.52204 9 6.12504 9Z"
                            fill="black"
                            fillOpacity={1}
                          />
                          <path
                            d="M18.1796 15.75H12.9333L12.8693 14.8418C12.7141 12.6398 11.9201 10.8076 10.7219 9.52435C11.3905 9.17864 12.1233 9 12.8749 9C15.4779 9 17.8548 11.1426 18.123 14.9473L18.1796 15.75Z"
                            fill="black"
                            fillOpacity={1}
                          />
                        </g>
                        <defs>
                          <clipPath id="clip0_1299_2107">
                            <rect
                              width="18"
                              height="18"
                              fill="white"
                              fillOpacity={1}
                              transform="translate(0.5)"
                            />
                          </clipPath>
                        </defs>
                      </svg>
                      <span className="text-sm">
                        15k+
                        {/* {formatCompactNumber(discordWidget.presence_count)} */}
                      </span>
                    </div>
                  </Button>
                </a>
              </div>
            </div>
          </div>

          <div className="absolute w-full -bottom-10 left-0 flex justify-center">
            <img
              className="abs animate-float scale-[175%] md:scale-100"
              src={CuteRobotFlyingPNG.src}
              alt=""
            />
          </div>
        </div>

        <div className="hidden size-4/5 xl:size-3/5 rounded-[20px] mx-auto relative -mt-40 lg:flex animate-scale-in delay-300">
          <div className="rounded-md size-full overflow-hidden">
            <img
              src={AppJanPNG.src}
              alt="Jan App Interface"
              className="w-full h-full object-fit"
            />
          </div>
        </div>

        <div className="lg:hidden size-full rounded-2xl mx-auto relative mt-10 flex animate-scale-in delay-300">
          <div className="rounded-lg size-full overflow-hidden">
            <img
              src={AppJanPNG.src}
              alt="Jan App Interface"
              className="w-full h-full object-fit"
            />
          </div>
        </div>
      </section>

      {/* Statistic and social */}
      <section className="pt-20">
        <div className="container mx-auto">
          <h2 className="text-[24px] lg:text-[52px] font-semibold text-center mb-16 -tracking-[1.3px]">
            Over 4 million downloads
          </h2>
        </div>
        <TweetSection />
      </section>

      {/* Social tech */}
      <section className="px-3 mt-20">
        <div className="bg-[#C6E09E] px-4 relative py-10 h-[640px] sm:h-[800px] lg:h-[900px] 2xl:h-[1040px] rounded-2xl overflow-hidden">
          <div className="container mx-auto relative z-10">
            <div className="md:mt-10">
              <div className="lg:w-3/5 mx-auto">
                <div className="relative text-center">
                  <h1
                    className="text-4xl lg:text-[50px] font-semibold -tracking-[1.3px] animate-on-scroll leading-tight"
                    data-delay="200"
                  >
                    Jan is built in public
                  </h1>
                  <p
                    className="-tracking-[0.6px] mt-4 text-xl text-neutral-700 animate-on-scroll lg:max-w-[512px] mx-auto"
                    data-delay="400"
                  >
                    We believe AI should be open, and grow <br/> through the people who build and use it
                  </p>
                </div>
                <div
                  className="mt-8 flex flex-col md:flex-row gap-4 animate-on-scroll"
                  data-delay="600"
                >
                  <a
                    href="https://github.com/janhq/jan"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="playful"
                      className="bg-[#2C2C2C] py-2  hover:bg-[#1a1a1a] text-white h-18 pl-2 justify-start w-full md:w-60 transition-colors duration-200"
                      size="xxl"
                    >
                      <span className="bg-white text-black flex items-center justify-center w-14 h-14 rounded-lg mr-2">
                        <FaGithub className="size-8" />
                      </span>
                      <span className="flex items-start flex-col">
                        <span className="font-bold text-lg">GitHub</span>
                        <span className="text-sm mt-1">
                          {formatCompactNumber(stars)} stars
                        </span>
                      </span>
                    </Button>
                  </a>
                  <a
                    href="https://discord.com/invite/FTk2MvZwJH"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="playful"
                      className="bg-[#5765F2] py-2 border-2 hover:bg-[#5765F2] text-white h-18 pl-2 justify-start w-full md:w-60 transition-colors duration-200"
                      size="xxl"
                    >
                      <span className="bg-white text-black flex items-center justify-center w-14 h-14 rounded-lg mr-2">
                        <FaDiscord className="size-8 text-[#5765F2]" />
                      </span>
                      <span className="flex items-start flex-col">
                        <span className="font-bold text-lg">Discord</span>
                        <span className="text-sm mt-1">
                          {formatCompactNumber(discordWidget.presence_count)}{' '}
                          Online
                        </span>
                      </span>
                    </Button>
                  </a>
                  <a
                    href="https://huggingface.co/janhq"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="playful"
                      className="bg-[#FFD21E] py-2 border-2 hover:bg-[#e6bd1b] text-black h-18 pl-2 justify-start w-full md:w-60 transition-colors duration-200"
                      size="xxl"
                    >
                      <span className="bg-white text-black flex items-center justify-center w-14 h-14 rounded-lg mr-2">
                        <img
                          src={HuggingFaceSVG.src}
                          alt="Hugging Face"
                          className="size-8"
                        />
                      </span>
                      <span className="flex items-start flex-col">
                        <span className="font-bold text-lg">HuggingFace</span>
                        <span className="text-sm mt-1">123 models</span>
                      </span>
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute w-full bottom-0 left-0 flex justify-center">
            <img
              className="animate-on-scroll"
              data-delay="800"
              src={CuteRobotBgMountainPNG.src}
              alt=""
            />
          </div>
        </div>
      </section>

      {/* Favorite Models Section */}
      <FavoriteModels />

      {/* Developer Community */}
      {/* <section className="px-3 pt-3">
        <div className="bg-[#93B3EF] lg:h-[1000px] relative pb-16 pt-8 md:pt-16 rounded-2xl overflow-hidden">
          <div className="container mx-auto relative z-10">
            <div className="text-center text-black my-12 mt-10">
              <h2
                className="-tracking-[1.3px] text-4xl lg:text-[52px] font-bold mb-4 leading-normal animate-on-scroll"
                data-delay="200"
              >
                Built in Public
              </h2>
              <p
                className="text-[24px] -tracking-[0.6px] max-w-2xl mx-auto animate-on-scroll text-black/70 font-medium"
                data-delay="400"
              >
                Our core team believes that AI should be open,{' '}
                <br className="hidden md:block" /> and Jan is built in public.
              </p>
            </div>
            <div className="max-w-4xl mx-auto px-4">
              <div
                className="bg-white rounded-lg shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border border-black animate-on-scroll-scale"
                data-delay="600"
              >
                <div className="p-6 space-y-6">
                  <div className="flex flex-col items-start gap-4 border-b border-neutral-400 pb-4">
                    <div className="flex justify-between w-full">
                      <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-sm">
                          <img src={CodeSVG.src} alt="" />
                        </span>
                      </div>
                      <a
                        className="hidden md:block"
                        href="https://github.com/janhq/jan"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="playful"
                          className="!rounded-lg border-2 h-[40px]"
                        >
                          <span>
                            <FaGithub className="size-4" />
                          </span>
                          <span className="text-base">Go to GitHub</span>
                        </Button>
                      </a>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-gray-900 text-[28px] -tracking-[0.7px]">
                          Develop
                        </h3>
                      </div>
                      <p className="text-gray-500 font-medium text-lg -tracking-[0.6px]">
                        Submit PRs for UI, tooling, or edge optimizations.
                      </p>
                      <a
                        className="md:hidden mt-4 block w-full"
                        href="https://github.com/janhq/jan"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="playful"
                          className="!rounded-lg border-2 h-[40px] w-full"
                        >
                          <span>
                            <FaGithub className="size-6" />
                          </span>
                          <span className="text-base">Go to GitHub</span>
                        </Button>
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-4 border-b border-neutral-400 pb-4">
                    <div className="flex justify-between w-full">
                      <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-sm">
                          <img src={ShareSVG.src} alt="" />
                        </span>
                      </div>
                      <a
                        className="hidden md:block"
                        href="https://discord.com/invite/FTk2MvZwJH"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="playful"
                          className="!rounded-lg border-2 h-[40px]"
                        >
                          <span>
                            <FaDiscord className="size-4 text-[#5765F2]" />
                          </span>
                          <span className="text-base">Join Community</span>
                          <div className="flex items-center gap-1 ml-3">
                            <IoMdPeople className="size-5" />
                            <span className="text-sm">
                              15k+
                              {formatCompactNumber(
                                discordWidget.presence_count
                              )}
                            </span>
                          </div>
                        </Button>
                      </a>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-gray-900 text-[28px] -tracking-[0.7px]">
                          Share
                        </h3>
                      </div>
                      <p className="text-gray-500 font-medium text-lg -tracking-[0.6px]">
                        Spread the word, write tutorials, host meet-ups, post
                        videos.
                      </p>
                      <a
                        className="md:hidden block mt-4 w-full"
                        href="https://discord.com/invite/FTk2MvZwJH"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="playful"
                          className="!rounded-lg w-full border-2 h-[40px]"
                        >
                          <span>
                            <FaDiscord className="size-6 text-[#5765F2]" />
                          </span>
                          <span className="text-base">Join Community</span>
                          <div className="flex items-center gap-1 ml-3">
                            <IoMdPeople className="size-5" />
                            <span className="text-sm">
                              15k+
                              {formatCompactNumber(
                                discordWidget.presence_count
                              )}
                            </span>
                          </div>
                        </Button>
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-4  pb-4">
                    <div className="flex justify-between w-full">
                      <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-sm">
                          <img src={RobotSVG.src} alt="" />
                        </span>
                      </div>
                      <a
                        className="hidden md:block"
                        href="https://huggingface.co/janhq"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="playful"
                          className="!rounded-lg border-2 h-[40px]"
                        >
                          <span>
                            <img
                              src={HuggingFaceSVG.src}
                              alt="Hugging Face"
                              className="size-4"
                            />
                          </span>
                          <span className="text-base">Check HuggingFace</span>
                        </Button>
                      </a>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-gray-900 text-[28px] -tracking-[0.7px]">
                          Train
                        </h3>
                      </div>
                      <p className="text-gray-500 font-medium text-lg -tracking-[0.6px]">
                        Add evals, safety tests, or training recipes.
                      </p>
                      <a
                        className="md:hidden block mt-4 w-full"
                        href="https://huggingface.co/janhq"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="playful"
                          className="!rounded-lg border-2 h-[40px] w-full"
                        >
                          <span>
                            <img
                              src={HuggingFaceSVG.src}
                              alt="Hugging Face"
                              className="size-6"
                            />
                          </span>
                          <span className="text-base">Check HuggingFace</span>
                        </Button>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute w-full bottom-0 flex justify-center">
            <img
              className="abs animate-on-scroll"
              data-speed="0.5"
              data-delay="800"
              src={CuteBuildingRobotPNG.src}
              alt=""
            />
          </div>
        </div>
      </section> */}

      {/* Call to action */}
      <section className="px-3 pt-3">
        <div className="bg-[#458edf] relative py-10 h-[480px] lg:h-[650px] rounded-2xl overflow-hidden">
          <div className="w-full lg:w-3/5 mx-auto">
            <div className="container relative z-10">
              <div className="mt-10 flex flex-col lg:flex-row justify-between items-center gap-8">
                <div className="relative animate-on-scroll" data-delay="200">
                  <h1 className="text-4xl text-center lg:text-left lg:text-5xl mx-auto font-semibold -tracking-[1.6px] text-white">
                    Ask Jan anything
                  </h1>
                </div>
                <div
                  className="bg-white flex flex-col p-0.5 rounded-2xl pb-2 shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black relative animate-on-scroll-scale"
                  data-delay="400"
                >
                  <DropdownButton
                    size="xl"
                    className="w-full lg:w-auto"
                    classNameButton="!shadow-none border-2"
                  />
                  <span className="text-xs font-medium text-center mt-2">
                    +{totalDownload(release)} downloads, Free & Open source
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute w-full lg:-bottom-30  bottom-0 flex justify-center">
            <img
              className="abs animate-float parallax-element scale-[175%] md:scale-100"
              data-speed="0.3"
              src={CuteRobotFlyingPNG.src}
              alt=""
            />
          </div>
        </div>
      </section>

      {/* <BuiltWithLove /> */}
      {/* <Feature /> */}
      {/* <APIStructure /> */}
      {/* <Customizable /> */}
      {/* <WallOfLove /> */}
      {/* <Principles /> */}
      {/* <CTANewsletter /> */}
      {/* <Statistic /> */}
      {/* <CTADownload /> */}
    </Fragment>
  )
}

export default Home
