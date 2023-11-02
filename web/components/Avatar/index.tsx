import React from 'react'

import SecondaryButton from '../SecondaryButton'

type Props = {
  allowEdit?: boolean
}

const Avatar: React.FC<Props> = ({ allowEdit = false }) => (
  <div className="mx-auto flex flex-col gap-5">
    <span className="mx-auto inline-block h-10 w-10 overflow-hidden rounded-full bg-gray-100">
      <svg
        className="mx-auto h-full w-full text-gray-300"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    </span>
    {allowEdit ?? <SecondaryButton title={'Edit picture'} />}
  </div>
)

export default Avatar
