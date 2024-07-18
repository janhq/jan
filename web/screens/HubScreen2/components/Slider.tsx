import React, { useEffect, useState } from 'react'

import { twMerge } from 'tailwind-merge'

import useModelHub, { QuickStartModel } from '@/hooks/useModelHub'

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from './Carousel'
import SliderItem from './SliderItem'

const Slider: React.FC = () => {
  const { data } = useModelHub()
  const [width, setWidth] = useState<number>(window.innerWidth)

  useEffect(() => {
    window.addEventListener('resize', () => {
      setWidth(window.innerWidth)
    })
    return () => {
      window.removeEventListener('resize', () => {
        setWidth(window.innerWidth)
      })
    }
  }, [])

  if (!data) return null
  const models = data.sliderData ?? []

  const normalizedModelsList: QuickStartModel[][] = []

  const getColumnCount = () => {
    if (width <= 670) return 1
    if (width <= 1000) return 2
    return 3
  }

  models.forEach((model, index) => {
    if (index % getColumnCount() === 0) {
      normalizedModelsList.push([model])
    } else {
      normalizedModelsList[normalizedModelsList.length - 1].push(model)
    }
  })

  return (
    <Carousel
      opts={{
        align: 'start',
      }}
      className="mx-16 my-12"
    >
      <CarouselContent className="pl-0">
        {normalizedModelsList.map((modelArray, index) => (
          <CarouselItem
            className={twMerge(
              'grid  gap-4 p-0',
              width > 1000 && 'grid-cols-3',
              width <= 1000 && 'grid-cols-2',
              width <= 670 && 'grid-cols-1'
            )}
            key={index}
          >
            {modelArray.map((model) => (
              <SliderItem model={model} key={model.model_name} />
            ))}
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}

export default Slider
