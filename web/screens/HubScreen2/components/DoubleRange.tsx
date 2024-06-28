import { Fragment, useEffect, useRef, useState } from 'react'

const SlideRange = () => {
  const minRef = useRef<HTMLInputElement>(null)
  const maxRef = useRef<HTMLInputElement>(null)
  const [minRange, setMinRange] = useState(1)
  const [maxRange, setMaxRange] = useState(100)

  useEffect(() => {
    if (minRange > maxRange) {
      setMinRange(maxRange)
    } else if (maxRange < minRange) {
      setMaxRange(minRange)
    }
  }, [minRange, maxRange])

  return (
    <Fragment>
      <div className="relative h-1 w-full rounded-md bg-[#0000000F]">
        <div
          style={{
            left: `${(minRange / 100) * 100}%`,
            right: `${100 - (maxRange / 100) * 100}%`,
          }}
          className="absolute left-1/4 right-1/4 h-full rounded-full bg-[#2563EB]"
        ></div>
        <input
          ref={minRef}
          className="pointer-events-none absolute -top-[5px] left-0 right-0 w-full appearance-none bg-transparent custom-slider"
          type="range"
          min="1"
          max={100}
          value={minRange}
          onChange={(e) => setMinRange(parseInt(e.target.value, 10))}
        />
        <input
          ref={maxRef}
          className="pointer-events-none absolute -top-[5px] left-0 right-0 w-full appearance-none bg-transparent custom-slider"
          type="range"
          min={1}
          max={100}
          value={maxRange}
          onChange={(e) => setMaxRange(parseInt(e.target.value, 10))}
        />
      </div>
      <div className="mt-1 flex w-full items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs text-[var(--text-secondary)]">from</span>
          <input className="h-8 w-[60px] rounded-md border" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-[var(--text-secondary)]">to</span>
          <input className="h-8 w-[60px] rounded-md border" />
        </div>
      </div>
    </Fragment>
  )
}

export default SlideRange
