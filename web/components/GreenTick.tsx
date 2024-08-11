import React from 'react'

const GreenTick: React.FC = () => (
  <svg
    width="14"
    height="15"
    viewBox="0 0 14 15"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 5.5C0 2.73858 2.23858 0.5 5 0.5H9C11.7614 0.5 14 2.73858 14 5.5V9.5C14 12.2614 11.7614 14.5 9 14.5H5C2.23858 14.5 0 12.2614 0 9.5V5.5Z"
      fill="#16A34A"
    />
    <path
      d="M10.3333 5L5.74996 9.58333L3.66663 7.5"
      stroke="white"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

export default React.memo(GreenTick)
