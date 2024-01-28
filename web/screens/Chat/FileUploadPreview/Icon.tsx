import React from 'react'

type Props = {
  type: string
}

const Icon: React.FC<Props> = ({ type }) => {
  return (
    <div className="relative">
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-medium uppercase">
        {type}
      </span>
      <svg
        width="34"
        height="42"
        viewBox="0 0 34 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g filter="url(#filter0_dd_2991_12588)">
          <path
            d="M26.274 10.2068C25.3629 10.2055 24.4894 9.84283 23.8453 9.19837C23.2011 8.55392 22.8389 7.68029 22.838 6.76912V2H7.48584C6.89683 1.99978 6.31354 2.11561 5.7693 2.34086C5.22507 2.56611 4.73054 2.89637 4.31397 3.31279C3.8974 3.7292 3.56694 4.2236 3.34149 4.76776C3.11603 5.31191 3 5.89517 3 6.48417V33.5158C3 34.1048 3.11603 34.6881 3.34149 35.2322C3.56694 35.7764 3.8974 36.2708 4.31397 36.6872C4.73054 37.1036 5.22507 37.4339 5.7693 37.6591C6.31354 37.8844 6.89683 38.0002 7.48584 38H25.9158C27.105 38 28.2456 37.5275 29.0865 36.6866C29.9275 35.8457 30.3999 34.7051 30.3999 33.5158V10.2068H26.274Z"
            fill="white"
          />
          <path
            d="M30.3998 10.2068H26.2739C25.3628 10.2055 24.4893 9.84283 23.8452 9.19837C23.201 8.55392 22.8388 7.68029 22.8379 6.76912V2L30.3998 10.2068Z"
            fill="#A1A1AA"
          />
        </g>
        <defs>
          <filter
            id="filter0_dd_2991_12588"
            x="0"
            y="0"
            width="33.3999"
            height="42"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="1" />
            <feGaussianBlur stdDeviation="1.5" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.0627451 0 0 0 0 0.0941176 0 0 0 0 0.156863 0 0 0 0.1 0"
            />
            <feBlend
              mode="normal"
              in2="BackgroundImageFix"
              result="effect1_dropShadow_2991_12588"
            />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feMorphology
              radius="1"
              operator="erode"
              in="SourceAlpha"
              result="effect2_dropShadow_2991_12588"
            />
            <feOffset dy="1" />
            <feGaussianBlur stdDeviation="1" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0"
            />
            <feBlend
              mode="normal"
              in2="effect1_dropShadow_2991_12588"
              result="effect2_dropShadow_2991_12588"
            />
            <feBlend
              mode="normal"
              in="SourceGraphic"
              in2="effect2_dropShadow_2991_12588"
              result="shape"
            />
          </filter>
        </defs>
      </svg>
    </div>
  )
}

export default Icon
