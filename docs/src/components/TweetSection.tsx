import { ClientTweetCard } from '@/components/ui/tweet-card'
import { useEffect } from 'react'

const Tweets = [
  { id: '1959360209970700621' },
  { id: '1959018716219277654' },
  { id: '1959410685093523580' },
  { id: '1959003819196785143' },
  { id: '1956547833999560863' },
  { id: '1956616098885079434' },
  { id: '1955283174340128809' },
  { id: '1955680680261652896' },
  { id: '1955624616560566446' },
  { id: '1955633387038966112' },
  { id: '1955326315160043918' },
  { id: '1952305678497747137' },
]

export default function TweetSection() {
  useEffect(() => {
    const buttons = document.querySelectorAll('.tweet-nav-btn')

    const handleClick = (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement
      const direction = button.dataset.direction
      const container = document.querySelector('.tweet-marquee-container')

      if (direction === 'left') {
        container?.scrollBy({ left: -300, behavior: 'smooth' })
      } else {
        container?.scrollBy({ left: 300, behavior: 'smooth' })
      }
    }

    buttons.forEach((button) => {
      button.addEventListener('click', handleClick)
    })

    return () => {
      buttons.forEach((button) => {
        button.removeEventListener('click', handleClick)
      })
    }
  }, [])

  return (
    <div className="space-y-4 !font-inter">
      {/* Scrollable marquee container */}
      <div className="tweet-marquee-container overflow-x-auto overflow-y-hidden">
        <div className="tweet-marquee flex gap-6 items-start">
          {/* Multiple copies for infinite scroll */}
          {[...Tweets, ...Tweets, ...Tweets].map((tweet, index) => (
            <div key={`${tweet.id}-${index}`} className="flex-shrink-0 w-80">
              <ClientTweetCard id={tweet.id} />
            </div>
          ))}
        </div>
      </div>

      {/* Navigation arrows at bottom - will need client-side JS */}
      <div className="flex justify-center gap-6">
        <button
          className="tweet-nav-btn size-12 cursor-pointer rounded-full border border-black shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center bg-white hover:bg-gray-50 transition-all"
          data-direction="left"
        >
          <svg
            width="25"
            height="24"
            viewBox="0 0 25 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10.5 18L4.5 12L10.5 6M5.5 12L20.5 12"
              stroke="black"
              strokeWidth="2"
              strokeLinecap="square"
            />
          </svg>
        </button>
        <button
          className="tweet-nav-btn size-12 cursor-pointer rounded-full border border-black shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center bg-white hover:bg-gray-50 transition-all"
          data-direction="right"
        >
          <svg
            width="25"
            height="24"
            viewBox="0 0 25 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M14.5 6L20.5 12L14.5 18M19.5 12H4.5"
              stroke="black"
              strokeWidth="2"
              strokeLinecap="square"
            />
          </svg>
        </button>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .tweet-marquee {
            animation: marquee 10s linear infinite;
          }
          
          .tweet-marquee:hover {
            animation-play-state: paused;
          }
          
          @keyframes marquee {
            0% {
              transform: translateX(0);
            }
            100% {
              transform: translateX(-33.33%);
            }
          }
          
          .tweet-marquee-container::-webkit-scrollbar {
            display: none;
          }
          
          .tweet-marquee-container {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
        `,
        }}
      />
    </div>
  )
}
