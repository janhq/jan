import React, { useEffect, useState } from 'react'

import { motion as m } from 'framer-motion'

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
      <div className="relative inline-block overflow-hidden rounded-lg bg-[hsla(var(--loader-bg))] px-4 py-2 font-semibold text-[hsla(var(--loader-fg))] shadow-lg">
        <m.div
          initial={{ width: 0 }}
          className="absolute left-0 top-0 h-full bg-[hsla(var(--loader-active-bg))]"
          style={{ width: 250 }}
          data-testid="response-loader"
          animate={{
            width: `${loader}%`,
            transition: {
              duration: 0.25,
            },
          }}
        />
        <span className="relative z-10">Generating response...</span>
      </div>
    </div>
  )
}
