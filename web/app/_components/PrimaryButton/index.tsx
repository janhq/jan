import React from 'react'

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
    className={`line-clamp-1 flex-shrink-0 rounded-md bg-blue-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-50 ${className} ${
      fullWidth ? 'flex-1 ' : ''
    }}`}
  >
    {title}
  </button>
)

export default PrimaryButton
