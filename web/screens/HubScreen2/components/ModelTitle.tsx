import Image from 'next/image'

type Props = {
  name: string
  image: string
  className?: string
}

const ModelTitle: React.FC<Props> = ({ name, image, className }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    {image && <Image width={20} height={20} src={image} alt="bot" />}
    <span>{name}</span>
  </div>
)
export default ModelTitle
