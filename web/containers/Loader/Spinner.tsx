import { motion } from 'framer-motion'

const Spinner = ({ size = 40, strokeWidth = 4, className = '' }) => {
  const radius = size / 2 - strokeWidth
  const circumference = 2 * Math.PI * radius

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ overflow: 'visible' }}
      animate={{ rotate: 360 }}
      className={className}
      transition={{
        repeat: Infinity,
        duration: 2, // Adjust for desired speed
        ease: 'linear',
      }}
    >
      {/* Static background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#e0e0e0"
        strokeWidth={strokeWidth}
        fill="none"
      />
      {/* Smooth animated arc */}
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.9} // Adjusted offset for smooth arc
        animate={{
          strokeDashoffset: [circumference, circumference * 0.1], // Continuous motion
        }}
        transition={{
          repeat: Infinity,
          duration: 1.5, // Adjust for animation speed
          ease: 'easeInOut', // Smooth easing
        }}
        strokeLinecap="round" // For a rounded end
      />
    </motion.svg>
  )
}

export default Spinner
