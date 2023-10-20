import React from 'react'

type Props = {
  title: string
  className?: string
}

const HeaderTitle: React.FC<Props> = ({ title, className }) => (
  <h2
    className={`my-5 text-[34px] font-semibold leading-[41px] tracking-[-0.4px] ${className}`}
  >
    {title}
  </h2>
)

export default React.memo(HeaderTitle)
