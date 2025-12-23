/* eslint-disable react-hooks/purity */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Snowflake {
  id: number
  x: number
  size: number
  duration: number
  delay: number
}

export function SnowAnimation() {
  const [snowflakes, setSnowflakes] = useState<Snowflake[]>([])

  useEffect(() => {
    const flakes: Snowflake[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: Math.random() * 3 + 2,
      duration: Math.random() * 3 + 2,
      delay: Math.random() * 2,
    }))
    setSnowflakes(flakes)
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {snowflakes.map((flake) => (
        <motion.div
          key={flake.id}
          className="absolute bg-[#252525]/20 dark:bg-white/60 rounded-full"
          style={{
            left: `${flake.x}%`,
            width: flake.size,
            height: flake.size,
            top: -10,
          }}
          animate={{
            y: ['0vh', '100vh'],
            x: [0, Math.random() * 100 - 50],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: flake.duration,
            delay: flake.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  )
}
