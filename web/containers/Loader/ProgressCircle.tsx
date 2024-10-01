import React from 'react'

interface ProgressCircleProps {
  percentage: number
  size?: number
  strokeWidth?: number
}

const ProgressCircle: React.FC<ProgressCircleProps> = ({
  percentage,
  size = 100,
  strokeWidth = 14,
}) => {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference

  return (
    <svg
      className="ml-0.5 h-4 w-4 rotate-[-90deg] transform text-[hsla(var(--primary-bg))]"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
    >
      <circle
        className="opacity-25"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
      ></circle>
      <circle
        className="transition-stroke-dashoffset duration-300"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      ></circle>
    </svg>
  )
}

export default ProgressCircle
