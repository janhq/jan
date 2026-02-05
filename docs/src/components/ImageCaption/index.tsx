import { PropsWithChildren } from 'react'

const ImageCaption = ({ children }: PropsWithChildren) => {
  return <div className="text-center mt-2 italic">{children}</div>
}

export default ImageCaption
