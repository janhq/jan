'use client' // Error components must be Client Components

import { useEffect, useState } from 'react'

export default function Error({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [showFull, setShowFull] = useState(false)
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])

  return (
    <>
      <div className="flex h-screen w-full items-center justify-center overflow-auto bg-white p-5">
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
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>
                <path
                  d="M17 16L22 21M22 16L17 21"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
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
              className="text-blue-600 hover:underline"
              onClick={() => window.location.reload()}
            >
              refresh this page
            </button>{' '}
            or <br /> feel free to{' '}
            <a
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
              href="https://discord.gg/FTk2MvZwJH"
              target="_blank_"
            >
              contact us
            </a>{' '}
            if the problem presists.
          </p>
          <div
            className="mt-5 w-full rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700"
            role="alert"
          >
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error.message}</span>
            <div className="mt-2 h-full w-full">
              <pre className="mt-2 w-full whitespace-pre-wrap rounded bg-red-200 p-4 text-left text-sm text-red-600">
                {showFull ? error.stack : error.stack?.slice(0, 200)}
              </pre>
              <button
                onClick={() => setShowFull(!showFull)}
                className="mt-1 text-sm text-red-700 underline focus:outline-none"
              >
                {showFull ? 'Show less' : 'Show more'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
