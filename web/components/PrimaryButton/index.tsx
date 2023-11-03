type Props = {
  title: string
  onClick?: () => void
  isSubmit?: boolean
  fullWidth?: boolean
  className?: string
}

const PrimaryButton: React.FC<Props> = ({
  title,
  onClick,
  isSubmit = false,
  fullWidth = false,
  className,
}) => (
  <button
    onClick={onClick}
    type={isSubmit ? 'submit' : 'button'}
    className={`bg-accent hover:bg-accent/80 line-clamp-1 flex-shrink-0 rounded-md px-3 py-1 font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${className} ${
      fullWidth ? 'flex-1 ' : ''
    }}`}
  >
    {title}
  </button>
)

export default PrimaryButton
