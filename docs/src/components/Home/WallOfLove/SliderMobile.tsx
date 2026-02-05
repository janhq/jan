import Autoplay from 'embla-carousel-autoplay'
import AutoScroll from 'embla-carousel-auto-scroll'
import AutoHeight from 'embla-carousel-auto-height'
import useEmblaCarousel from 'embla-carousel-react'
import { PrevButton, NextButton, usePrevNextButtons } from './ArrowButtonMobile'
import { Tweet } from 'react-tweet'

const slideForMobile = [
  {
    type: 'tweet',
    id: '1742843063938994469',
  },
  {
    type: 'youtube',
    id: 'zkafOIyQM8s',
  },

  {
    type: 'youtube',
    id: 'QpMQgJL4AZA',
  },
  {
    type: 'tweet',
    id: '1744729548074459310',
  },
  {
    type: 'youtube',
    id: '7JpzE-_cKo4',
  },
  {
    type: 'tweet',
    id: '1757504717519749292',
  },
  {
    type: 'youtube',
    id: 'ZCiEQVOjH5U',
  },
  {
    type: 'tweet',
    id: '1757500111629025788',
  },
  {
    type: 'tweet',
    id: '1742993414986068423',
  },
  {
    type: 'youtube',
    id: '9ta2S425Zu8',
  },

  {
    type: 'youtube',
    id: 'ES021_sY6WQ',
  },
  {
    type: 'youtube',
    id: 'CbJGxNmdWws',
  },
]

const SliderMobile = () => {
  const [emblaRefMobile, emblaApiMobile] = useEmblaCarousel(
    { slidesToScroll: 'auto', loop: true },
    [AutoHeight(), Autoplay(), AutoScroll({ playOnInit: false })]
  )

  const {
    prevBtnDisabled,
    nextBtnDisabled,
    onPrevButtonClick,
    onNextButtonClick,
  } = usePrevNextButtons(emblaApiMobile)

  return (
    <>
      <div className="embla__controls lg:!hidden mb-4">
        <div className="embla__buttons space-x-2">
          <PrevButton onClick={onPrevButtonClick} disabled={prevBtnDisabled} />
          <NextButton onClick={onNextButtonClick} disabled={nextBtnDisabled} />
        </div>
      </div>
      <div className="embla tweet-wrapper" ref={emblaRefMobile}>
        <div className="embla__container flex lg:!hidden">
          {slideForMobile.map((item, i) => {
            return (
              <div className="embla__slide px-4 cursor-move" key={i}>
                <>
                  {item.type === 'tweet' && (
                    <div key={i} className="tweet-wrapper text-left">
                      <Tweet id={item.id} />
                    </div>
                  )}
                  {item.type === 'youtube' && (
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
                  )}
                </>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export default SliderMobile
