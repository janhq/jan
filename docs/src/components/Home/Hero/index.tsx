import DropdownDownload from '@/components/DropdownDownload'
import ThemeImage from '@/components/ThemeImage'
import { totalDownload } from '@/utils/format'
import Link from 'next/link'
import { useData } from 'nextra/data'

const QuoteIcon = () => {
  return (
    <div className="absolute ml-4 sm:ml-10 md:ml-20 -mt-20 lg:-mt-10">
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M33.7939 65.5999H11.6294V38.1159C11.6294 30.7278 13.1071 25.1128 16.0623 21.2709C19.3131 17.2813 24.7804 14.991 32.4641 14.3999V27.477C29.8043 27.477 27.5879 28.5852 25.8147 30.8016C24.9281 31.9837 24.4849 34.2741 24.4849 37.6726V41.8839H33.7939V65.5999ZM68.3706 65.5999H46.2061V38.1159C46.2061 30.7278 47.5359 25.3344 50.1957 21.9358C53.742 17.5029 59.357 14.991 67.0407 14.3999V27.477C62.46 27.477 59.8742 29.7673 59.2831 34.348C59.1354 34.939 59.0615 36.0472 59.0615 37.6726V41.8839H68.3706V65.5999Z"
          fill="url(#paint0_linear_441_25144)"
        />
        <defs>
          <linearGradient
            id="paint0_linear_441_25144"
            x1="-116.909"
            y1="39.9508"
            x2="143.834"
            y2="39.9508"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#6FB538" />
            <stop offset="1" stopColor="#38B588" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

const Hero = () => {
  const { lastVersion, lastRelease, release } = useData()

  return (
    <div className="nextra-wrap-container">
      <div className="mt-10 text-center">
        <div>
          <Link
            href="https://github.com/janhq/jan/releases"
            target="_blank"
            className="hidden lg:inline-block"
          >
            <div className="inline-flex my-2 py-2 pl-2 pr-4 rounded-lg bg-indigo-500 text-white">
              <div className="flex items-center rounded bg-white px-2">
                <span className="font-bold uppercase text-blue-600">new</span>
              </div>
              &nbsp;✨&nbsp; <b>{lastVersion}</b>&nbsp;is now live on
              GitHub.&nbsp;Check it out!
            </div>
          </Link>
        </div>

        <div className="relative inline-block mt-20">
          <QuoteIcon />
          <h1 className="text-6xl lg:text-[80px] !font-normal leading-tight lg:leading-tight mt-2 font-serif">
            Chat with AI <br /> without privacy concerns
          </h1>

          <div className="py-8 flex justify-center">
            {/* <LifeHackerLogo /> */}
            <ThemeImage
              className=""
              source={{
                light: '/assets/images/homepage/lifehacker-light.png',
                dark: '/assets/images/homepage/lifehacker-dark.png',
              }}
              priority
              alt="App screenshots"
              width={110}
              height={110}
            />
          </div>

          <p className="text-xl -mt-1 leading-relaxed text-black/60 dark:text-white/60">
            Jan is an open source ChatGPT-alternative that runs 100% offline.
          </p>
        </div>
        <div className="mb-4 mt-8">
          <DropdownDownload lastRelease={lastRelease} />
        </div>
        <p className="mt-6 text-black/60 dark:text-white/60">
          <span className="text-[#EDA703] font-semibold">
            {totalDownload(release)}+
          </span>
          &nbsp;downloads | Free & Open Source
        </p>
        <div className="w-4/5 mx-auto mt-10 relative">
          <ThemeImage
            className="absolute object-cover w-full object-center mx-auto h-full top-0 left-0 scale-125"
            source={{
              light: '/assets/images/homepage/glow.png',
              dark: '/assets/images/homepage/glow.png',
            }}
            priority
            alt="App screenshots"
            width={800}
            height={800}
          />
          <ThemeImage
            className="object-cover w-full object-center mx-auto h-full relative"
            source={{
              light: '/assets/images/homepage/app-frame-light-fixed.png',
              dark: '/assets/images/homepage/app-frame-light-fixed.png',
            }}
            priority
            alt="App screenshots"
            width={800}
            height={800}
          />
        </div>
      </div>
    </div>
  )
}

export default Hero
