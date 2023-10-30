import React from 'react'
import { Button } from '@uikit'

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
  <Button
    size="sm"
    disabled={disabled}
    type="button"
    onClick={onClick}
    className={className}
  >
    {icon}&nbsp;
    {title}
  </Button>
)

export default React.memo(SecondaryButton)
