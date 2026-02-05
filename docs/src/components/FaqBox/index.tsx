import React, { PropsWithChildren } from 'react'

type Props = {
  title: string
} & PropsWithChildren

const FAQBox = ({ title, children }: Props) => {
  return (
    <details
      open
      className="last-of-type:mb-0 rounded-lg bg-neutral-50 dark:bg-neutral-800 p-2 mt-4"
    >
      <summary>
        <strong className="text-lg ml-2">{title}</strong>
      </summary>
      <div className="nx-p-2">{children}</div>
    </details>
  )
}

export default FAQBox
