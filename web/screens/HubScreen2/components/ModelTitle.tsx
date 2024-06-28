type Props = {
  name: string
  image: string
  className?: string
}

const ModelTitle: React.FC<Props> = ({ name, image, className }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <img className="h-5 w-5 rounded-full object-cover" src={image} alt="bot" />
    <span>{name}</span>
  </div>
)
export default ModelTitle
