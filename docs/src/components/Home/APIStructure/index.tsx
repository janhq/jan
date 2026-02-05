import React from 'react'

const endpoints = [
  {
    name: '/threads',
    status: '100% complete',
  },
  {
    name: '/messages',
    status: '100% complete',
  },
  {
    name: '/models',
    status: '90% complete',
  },
  {
    name: '/chat/completions',
    status: '70% complete',
  },
  {
    name: '/assistants',
    status: '30% complete',
  },
  {
    name: '/fine-tuning',
    status: 'Coming soon',
  },
  {
    name: '/files',
    status: 'Coming soon',
  },
  {
    name: '/...',
    status: 'Coming soon',
  },
]

const renderDot = (status: string) => {
  switch (status) {
    case 'Coming soon':
      return <div className="w-2 h-2 bg-gray-400 rounded-full" />

    case '100% complete':
      return <div className="w-2 h-2 bg-green-400 rounded-full" />

    default:
      return <div className="w-2 h-2 bg-yellow-600 rounded-full" />
  }
}

const APIStructure = () => {
  return (
    <div className="pt-24 pb-20 nextra-wrap-container">
      <div className="w-full text-center">
        <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
          Fully OpenAI-Equivalent API
        </h1>
        <div className="lg:w-1/2 mx-auto">
          <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60">
            Jan provides an OpenAI-equivalent API server at localhost:&nbsp;
            <span className="bg-blue-600 text-white font-bold px-2 py-0.5 rounded-md">
              1337
            </span>{' '}
            that can be used as a drop-in replacement with compatible apps.
          </p>
        </div>
      </div>
      <div className="flex px-4 flex-col lg:flex-row items-center">
        <div className="w-full lg:w-1/2 mx-auto text-center my-8">
          <a
            className="text-black dark:text-white bg-[#F0F0F0] dark:bg-[#242424] cursor-pointer font-bold py-3 px-5 rounded-lg border border-ragy-200 dark:border-neutral-700"
            href="https://cortex.so/api-reference"
            target="_blank"
          >
            API Reference
          </a>
        </div>
      </div>
      <div className="bg-[#fff] shadow-xl dark:shadow-none dark:bg-[#242424] lg:w-2/5 px-4 py-2 mx-auto rounded-xl mt-4">
        {endpoints.map((item, i) => {
          return (
            <div
              key={i}
              className="flex justify-between py-2.5 border-b border-gray-200 dark:border-neutral-700 last:border-none"
            >
              <div className="flex gap-x-4 items-center">
                {renderDot(item.status)}
                <h6 className="font-bold">{item.name}</h6>
              </div>
              <p className="text-xs">{item.status}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default APIStructure
