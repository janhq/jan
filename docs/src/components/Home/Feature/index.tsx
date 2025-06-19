import ThemeImage from '@/components/ThemeImage'
import { useState } from 'react'
// import { BsArrowRight } from 'react-icons/bs'
import { twMerge } from 'tailwind-merge'

const features = [
  {
    title: 'Chat with AI',
    experimantal: false,
    description:
      'Ask your questions, brainstorm, and learn from the AI running on your device to be more productive.',
    image: {
      light: '/assets/images/homepage/features01.png',
      dark: '/assets/images/homepage/features01dark.png',
    },
  },
  {
    title: 'Model Hub',
    experimantal: false,
    description: `Download and Run powerful models like Llama3, Gemma or Mistral on your computer.`,
    image: {
      light: '/assets/images/homepage/features02.png',
      dark: '/assets/images/homepage/features02dark.png',
    },
  },
  {
    title: 'Connect to Cloud AIs',
    experimantal: false,
    description: `You can also route to more powerful cloud models, like OpenAI, Groq, Cohere etc., when needed.`,
    image: {
      light: '/assets/images/homepage/features03.png',
      dark: '/assets/images/homepage/features03dark.png',
    },
  },
  {
    title: 'Local API Server',
    experimantal: false,
    description: `Set up and run your own OpenAI-compatible API server using local models with just one click.`,
    image: {
      light: '/assets/images/homepage/features04.png',
      dark: '/assets/images/homepage/features04dark.png',
    },
  },
  {
    title: 'Chat with your files',
    experimantal: true,
    description: `Talk to PDFs, notes, and other documents directly to get summaries, answers, or insights.`,
    image: {
      light: '/assets/images/homepage/features05.png',
      dark: '/assets/images/homepage/features05dark.png',
    },
  },
]

const Feature = () => {
  const [activeFeature, setActiveFeature] = useState(0)

  return (
    <>
      <div className="nextra-wrap-container">
        <div className="w-full mx-auto relative py-8 lg:pt-24">
          <div className="flex p-4 lg:px-0 lg:justify-between flex-col lg:flex-row items-center">
            <div className="w-full text-center lg:text-left">
              <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
                Features
              </h1>
            </div>
          </div>

          <div className="flex lg:flex-row flex-col items-start gap-10 xl:gap-14 mt-10">
            <div className="w-full lg:w-1/2 px-4 lg:p-0">
              {features.map((feature, i) => {
                const isActive = activeFeature === i
                return (
                  <div
                    key={i}
                    className={twMerge(
                      'mb-4 py-6 lg:p-6 rounded-xl cursor-pointer',
                      isActive && 'lg:dark:bg-[#1F1F1F] lg:bg-[#F5F5F5]'
                    )}
                    onClick={() => setActiveFeature(i)}
                  >
                    <div
                      className={twMerge(
                        'flex items-center gap-4',
                        isActive && 'items-start'
                      )}
                    >
                      <h1 className="dark:text-[#4C4C4C] text-[#C4C4C4] text-[32px] font-bold">
                        0{i + 1}
                      </h1>
                      <div>
                        <div className="flex flex-col lg:flex-row lg:items-center gap-x-2">
                          <h6 className="text-xl font-bold">{feature.title}</h6>
                          {feature.experimantal && (
                            <div className="flex mt-2 lg:mt-0">
                              <div className="font-medium text-sm bg-blue-100 rounded-lg px-2 py-1 text-blue-700">
                                Experimental
                              </div>
                            </div>
                          )}
                        </div>
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
                    <div className="lg:hidden block mt-4">
                      <ThemeImage
                        alt="App Screenshot Feature"
                        width={800}
                        height={800}
                        className="w-full h-full object-cover object-center"
                        priority
                        source={{
                          light: feature.image?.light,
                          dark: feature.image?.dark,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="relative w-full overflow-hidden  hidden lg:block">
              {activeFeature === 0 && (
                <ThemeImage
                  alt="App Screenshot Feature"
                  width={800}
                  height={800}
                  className="w-full h-full object-cover object-center"
                  priority
                  source={{
                    light: '/assets/images/homepage/features01.png',
                    dark: '/assets/images/homepage/features01dark.png',
                  }}
                />
              )}
              {activeFeature === 1 && (
                <ThemeImage
                  alt="App Screenshot Feature"
                  width={800}
                  height={800}
                  className="w-full h-full object-cover object-center"
                  priority
                  source={{
                    light: '/assets/images/homepage/features02.png',
                    dark: '/assets/images/homepage/features02dark.png',
                  }}
                />
              )}
              {activeFeature === 2 && (
                <ThemeImage
                  alt="App Screenshot Feature"
                  width={800}
                  height={800}
                  className="w-full h-full object-cover object-center"
                  priority
                  source={{
                    light: '/assets/images/homepage/features03.png',
                    dark: '/assets/images/homepage/features03dark.png',
                  }}
                />
              )}
              {activeFeature === 3 && (
                <ThemeImage
                  alt="App Screenshot Feature"
                  width={800}
                  height={800}
                  className="w-full h-full object-cover object-center"
                  priority
                  source={{
                    light: '/assets/images/homepage/features04.png',
                    dark: '/assets/images/homepage/features04dark.png',
                  }}
                />
              )}
              {activeFeature === 4 && (
                <ThemeImage
                  alt="App Screenshot Feature"
                  width={800}
                  height={800}
                  className="w-full h-full object-cover object-center"
                  priority
                  source={{
                    light: '/assets/images/homepage/features05.png',
                    dark: '/assets/images/homepage/features05dark.png',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Feature
