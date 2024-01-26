import React, { useEffect, useState } from 'react'

export default function GenerateResponse() {
  const [loader, setLoader] = useState(0)

  // This is fake loader please fix this when we have realtime percentage when load model
  useEffect(() => {
    if (loader === 24) {
      setTimeout(() => {
        setLoader(loader + 1)
      }, 250)
    } else if (loader === 50) {
      setTimeout(() => {
        setLoader(loader + 1)
      }, 250)
    } else if (loader === 78) {
      setTimeout(() => {
        setLoader(loader + 1)
      }, 250)
    } else if (loader === 85) {
      setLoader(85)
    } else {
      setLoader(loader + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader])

  return (
    <div className=" mb-1 mt-2 py-2 text-center">
      <div className="relative inline-block overflow-hidden rounded-lg border border-neutral-50 bg-gray-50 px-4 py-2 font-semibold text-gray-600 shadow-lg">
        <div
          className="absolute left-0 top-0 h-full bg-gray-200"
          style={{ width: `${loader}%` }}
        />
        <span className="relative z-10">Generating response...</span>
      </div>
    </div>
  )
}
