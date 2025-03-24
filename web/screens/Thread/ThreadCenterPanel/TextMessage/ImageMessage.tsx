import { memo } from 'react'

import { RelativeImage } from '../TextMessage/RelativeImage'

const ImageMessage = ({ image }: { image: string }) => {
  return (
    <div className="group/file relative mb-2 mt-1 inline-flex overflow-hidden rounded-xl">
      <RelativeImage src={image} />
    </div>
  )
}

export default memo(ImageMessage)
