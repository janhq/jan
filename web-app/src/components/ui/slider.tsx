<<<<<<< HEAD
import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'
=======
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
<<<<<<< HEAD
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
=======
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
<<<<<<< HEAD
          'bg-main-view-fg/10 relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
=======
          "bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
<<<<<<< HEAD
            'bg-accent absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
=======
            "bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
<<<<<<< HEAD
          className="border-accent bg-main-view ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-2 ring-accent focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
=======
          className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
