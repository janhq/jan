import useEmblaCarousel from 'embla-carousel-react'
import { Tweet } from 'react-tweet'
import AutoScroll from 'embla-carousel-auto-scroll'
import { PrevButton, NextButton, usePrevNextButtons } from './ArrowButton'
import SliderMobile from './SliderMobile'
import { twMerge } from 'tailwind-merge'

const firstSLide = {
  firstColumn: [
    {
      type: 'tweet',
      id: '1742843063938994469',
    },
    {
      type: 'youtube',
      id: 'zkafOIyQM8s',
    },
  ],
  secondColumn: [
    {
      type: 'youtube',
      id: 'QpMQgJL4AZA',
    },
    {
      type: 'tweet',
      id: '1744729548074459310',
    },
  ],
  thirdColumn: [
    {
      type: 'tweet',
      id: '1745560583548670250',
    },
  ],
  fourthColumn: [
    {
      type: 'youtube',
      id: '7JpzE-_cKo4',
    },
    {
      type: 'tweet',
      id: '1757504717519749292',
    },
  ],
}

const secondSlide = {
  firstColumn: [
    {
      type: 'youtube',
      id: 'ZCiEQVOjH5U',
    },
    {
      type: 'tweet',
      id: '1757500111629025788',
    },
  ],
  secondColumn: [
    {
      type: 'tweet',
      id: '1750801065132384302',
    },
  ],
  thirdColumn: [
    {
      type: 'tweet',
      id: '1742993414986068423',
    },
    {
      type: 'youtube',
      id: '9ta2S425Zu8',
    },
  ],
  fourthColumn: [
    {
      type: 'youtube',
      id: 'ES021_sY6WQ',
    },
    {
      type: 'youtube',
      id: 'CbJGxNmdWws',
    },
  ],
}

type Props = {
  transparent?: boolean
}

const WallOfLove = ({ transparent }: Props) => {
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { slidesToScroll: 'auto', loop: true },
    [AutoScroll({ playOnInit: false })]
  )

  const {
    prevBtnDisabled,
    nextBtnDisabled,
    onPrevButtonClick,
    onNextButtonClick,
  } = usePrevNextButtons(emblaApi)

  return (
    <div
      className={twMerge(
        'bg-[#F0F0F0] dark:bg-[#242424] py-8 mt-10 pb-10',
        transparent && 'bg-transparent dark:bg-transparent py-0'
      )}
    >
      <div className="nextra-wrap-container">
        <div className="w-full mx-auto relative lg:p-8 text-center flex justify-between">
          <div className="hidden lg:block">
            <PrevButton
              onClick={onPrevButtonClick}
              disabled={prevBtnDisabled}
            />
          </div>
          <div>
            <h1 className="text-5xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
              People Say Nice Things
            </h1>
            <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60 flex gap-x-2 justify-center">
              ...despite our bugs and fast moving releases&nbsp;
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className="lg:inline-block hidden"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_1810_7276)">
                  <path
                    d="M24.0001 11.4301H22.8601V19.4326H24.0001V11.4301Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M22.8599 19.4325H21.7124V20.5725H22.8599V19.4325Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M22.8599 9.14246H21.7124V11.43H22.8599V9.14246Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M21.7125 20.5725H20.5725V21.72H21.7125V20.5725Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M21.7125 6.86255H20.5725V9.14255H21.7125V6.86255Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M20.5726 21.72H19.4326V22.86H20.5726V21.72Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M20.5726 5.71497H19.4326V6.86247H20.5726V5.71497Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M19.4324 2.28748H18.2849V5.71498H19.4324V2.28748Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M12.5701 22.86V21.72H14.8576V20.5725H11.4301V21.72H5.71509V22.86H11.4301V24H19.4326V22.86H12.5701Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M18.285 1.14746H17.145V2.28746H18.285V1.14746Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M17.1449 11.4301H14.8574V12.5701H17.1449V11.4301Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M16.0049 19.4325H14.8574V20.5725H16.0049V19.4325Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M17.145 0H13.7175V1.1475H17.145V0Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M14.8575 18.285H13.7175V19.4325H14.8575V18.285Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M14.8575 12.5699H13.7175V13.7174H14.8575V12.5699Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M16.005 2.28748H13.7175V4.57498H16.005V2.28748Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M13.7176 13.7175H12.5701V18.285H13.7176V13.7175Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M13.7176 1.14746H12.5701V2.28746H13.7176V1.14746Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M12.5699 2.28748H11.4299V4.57498H12.5699V2.28748Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M11.43 19.4325H10.29V20.5725H11.43V19.4325Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M10.2901 16.005H9.14258V19.4325H10.2901V16.005Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M11.4301 4.57495H9.14258V5.71495H11.4301V4.57495Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M9.14244 14.8575H8.00244V16.005H9.14244V14.8575Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M9.14244 6.86255H8.00244V8.00255H9.14244V6.86255Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M9.14244 2.28748H8.00244V4.57498H9.14244V2.28748Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M8.00255 1.14746H6.86255V2.28746H8.00255V1.14746Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M8.00245 8.00244H4.57495V9.14244H8.00245V8.00244Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M5.71495 20.5725H4.57495V21.72H5.71495V20.5725Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M6.86249 0H3.42749V1.1475H6.86249V0Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M1.1475 22.86V21.72H0V24H5.715V22.86H1.1475Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M8.0026 13.7175H2.2876V14.8575H8.0026V13.7175Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M5.71499 2.28748H3.42749V4.57498H5.71499V2.28748Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M3.42746 20.5725H4.57496V19.4325H2.28746V20.5725H1.14746V21.72H3.42746V20.5725Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M3.4276 5.71497H2.2876V8.00247H3.4276V5.71497Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M3.4276 1.14746H2.2876V2.28746H3.4276V1.14746Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M2.28746 18.285H1.14746V19.4325H2.28746V18.285Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M2.28746 8.00244H1.14746V10.2899H2.28746V8.00244Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M2.28746 2.28748H1.14746V5.71498H2.28746V2.28748Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                  <path
                    d="M2.2875 16.005V14.8575H1.1475V10.29H0V18.285H1.1475V16.005H2.2875Z"
                    className="fill-black/60 dark:fill-white/60"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_1810_7276">
                    <rect width="24" height="24" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </p>
          </div>
          <div className="hidden lg:block">
            <NextButton
              onClick={onNextButtonClick}
              disabled={nextBtnDisabled}
            />
          </div>
        </div>
      </div>
      <div className="w-full mx-auto relative text-center overflow-hidden mt-10 px-4">
        <div className="embla tweet-wrapper" ref={emblaRef}>
          <div className="embla__container !hidden md:!flex">
            <div className="embla__slide px-4 cursor-move">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8 text-left">
                <div className="space-y-4 lg:space-y-8">
                  {firstSLide.firstColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
                <div className="space-y-4 lg:space-y-8">
                  {firstSLide.secondColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
                <div className="space-y-4 lg:space-y-8">
                  {firstSLide.thirdColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
                <div className="space-y-4 lg:space-y-8">
                  {firstSLide.fourthColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
              </div>
            </div>
            <div className="embla__slide px-4 cursor-move">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8 text-left">
                <div className="space-y-4 lg:space-y-8">
                  {secondSlide.firstColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
                <div className="space-y-4 lg:space-y-8">
                  {secondSlide.secondColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
                <div className="space-y-4 lg:space-y-8">
                  {secondSlide.thirdColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
                <div className="space-y-4 lg:space-y-8">
                  {secondSlide.fourthColumn.map((item, i) => {
                    if (item.type === 'tweet')
                      return (
                        <div key={i} className="tweet-wrapper">
                          <Tweet id={item.id} />
                        </div>
                      )
                    if (item.type === 'youtube')
                      return (
                        <div key={i}>
                          <iframe
                            width="100%"
                            height="260"
                            src={`https://www.youtube.com/embed/${item.id}`}
                            title="Install Jan to Run LLM Offline and Local First"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            className="rounded-xl"
                            loading="lazy"
                            {...(item.type === 'youtube'
                              ? { noindex: 'true' }
                              : {})}
                          />
                        </div>
                      )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile */}
        <SliderMobile />
      </div>
    </div>
  )
}

export default WallOfLove
