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
  <Button disabled={disabled} type="button" onClick={onClick}>
    {icon}
    {title}
  </Button>
)

export default React.memo(SecondaryButton)
