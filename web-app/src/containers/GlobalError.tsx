import { useState } from 'react'

interface GlobalErrorProps {
  error: Error | unknown
}

export default function GlobalError({ error }: GlobalErrorProps) {
  console.error('Error in root route:', error)
  const [showFull, setShowFull] = useState(false)

  return (
    <div className="flex h-screen w-full items-center justify-center overflow-auto bg-red-50 p-5">
      <div className="w-full text-center">
        <div className="inline-flex rounded-full bg-red-100 p-4">
          <div className="rounded-full bg-red-200 stroke-red-600 p-4">
            <svg
              className="h-16 w-16"
              viewBox="0 0 28 28"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 8H6.01M6 16H6.01M6 12H18C20.2091 12 22 10.2091 22 8C22 5.79086 20.2091 4 18 4H6C3.79086 4 2 5.79086 2 8C2 10.2091 3.79086 12 6 12ZM6 12C3.79086 12 2 13.7909 2 16C2 18.2091 3.79086 20 6 20H14"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              ></path>
              <path
                d="M17 16L22 21M22 16L17 21"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              ></path>
            </svg>
          </div>
        </div>
        <h1 className="mt-5 text-xl font-bold text-slate-800">
          Oops! Unexpected error occurred.
        </h1>
        <p className="lg:text-md my-2 text-slate-600">
          Something went wrong. Try to{' '}
          <button
            rel="noopener noreferrer"
            className="text-accent hover:underline"
            onClick={() => window.location.reload()}
          >
            refresh this page
          </button>{' '}
          or <br /> feel free to{' '}
          <a
            rel="noopener noreferrer"
<<<<<<< HEAD
            className="!text-accent hover:underline"
=======
            className="text-accent! hover:underline"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            href="https://discord.gg/FTk2MvZwJH"
            target="_blank"
          >
            contact us
          </a>{' '}
          if the problem persists.
        </p>
        <div
<<<<<<< HEAD
          className="mt-5 w-full md:w-4/5 mx-auto rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700 "
=======
          className="mt-5 w-full md:w-4/5 xl:w-4/6 mx-auto rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700 "
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          role="alert"
        >
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">
            {error instanceof Error ? error.message : String(error)}
          </span>
          <div className="mt-2 h-full w-full">
            <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-red-200 p-4 text-left text-sm text-red-600 max-h-[250px] overflow-y-auto">
              <code>
                {error instanceof Error
                  ? showFull
                    ? error.stack
                    : error.stack?.slice(0, 200)
                  : String(error)}
              </code>
            </pre>
            <button
              onClick={() => setShowFull(!showFull)}
              className="mt-2 text-sm text-red-700 underline focus:outline-none cursor-pointer"
            >
              {showFull ? 'Show less' : 'Show more'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
