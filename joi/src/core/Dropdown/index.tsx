import React, { Fragment, PropsWithChildren, ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import './styles.scss'
import { twMerge } from 'tailwind-merge'

type Props = {
  options?: { name: ReactNode; value: string; suffix?: ReactNode }[]
  className?: string
  onValueChanged?: (value: string) => void
}

const Dropdown = (props: PropsWithChildren & Props) => {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{props.children}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={twMerge(props.className, 'DropdownMenuContent')}
          sideOffset={0}
          align="end"
        >
          {props.options?.map((e, i) => (
            <Fragment key={e.value}>
              {i !== 0 && (
                <DropdownMenu.Separator className="DropdownMenuSeparator" />
              )}
              <DropdownMenu.Item
                className="DropdownMenuItem"
                onClick={() => props.onValueChanged?.(e.value)}
              >
                {e.name}
                <div />
                {e.suffix}
              </DropdownMenu.Item>
            </Fragment>
          ))}
          <DropdownMenu.Arrow className="DropdownMenuArrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export { Dropdown }
