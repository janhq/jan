import React from 'react'

type Props = {
  title: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  icon?: React.ReactNode
}

const SecondaryButton: React.FC<Props> = ({
  title,
  onClick,
  disabled,
  className,
  icon,
}) => (
  <button
    disabled={disabled}
    type="button"
    onClick={onClick}
    className={className}
  >
    {icon}&nbsp;
    {title}
  </button>
)

export default React.memo(SecondaryButton)
