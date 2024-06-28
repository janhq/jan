import React from 'react'

import { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from './Carousel'
import SliderItem from './SliderItem'

type Props = {
  models: HuggingFaceModelEntry[]
}

const Slider: React.FC<Props> = ({ models }) => {
  const normalizedModelsList: HuggingFaceModelEntry[][] = []
  models.forEach((model, index) => {
    if (index % 2 === 0) {
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
          <CarouselItem className="grid grid-cols-2 gap-4 p-0" key={index}>
            {modelArray.map((model) => (
              <SliderItem model={model} key={model.name} />
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
