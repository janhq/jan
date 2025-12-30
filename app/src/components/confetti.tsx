import { useEffect, useRef, createContext, useContext, useState } from 'react'
import confetti from 'canvas-confetti'
import type { CreateTypes as ConfettiInstance } from 'canvas-confetti'
import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@/components/ui/button'

const ConfettiContext = createContext<{
  instance: ConfettiInstance | null
  showDiscoBall: boolean
  setShowDiscoBall: (show: boolean) => void
}>({
  instance: null,
  showDiscoBall: false,
  setShowDiscoBall: () => {},
})

export function ConfettiCanvas({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [confettiInstance, setConfettiInstance] =
    useState<ConfettiInstance | null>(null)
  const [showDiscoBall, setShowDiscoBall] = useState(false)

  useEffect(() => {
    if (!canvasRef.current) return

    const instance = confetti.create(canvasRef.current, {
      resize: true,
      useWorker: false,
    })

    setConfettiInstance(instance)

    return () => {
      instance.reset()
    }
  }, [])

  return (
    <ConfettiContext.Provider
      value={{ instance: confettiInstance, showDiscoBall, setShowDiscoBall }}
    >
      {children}
      <AnimatePresence>
        {showDiscoBall && (
          <motion.div
            initial={{ y: -200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -200, opacity: 0 }}
            transition={{
              duration: 0.5,
              ease: 'easeOut',
            }}
            className="fixed right-10 md:right-24 top-0 pointer-events-none z-9999"
          >
            <motion.img
              src="/disco-ball.png"
              alt="Disco ball"
              className="size-40 object-contain"
              animate={{
                x: [0, 15, 0, -15, 0],
                y: [0, -10, -5, -10, 0],
                rotate: [0, 3, 0, -3, 0],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ConfettiContext.Provider>
  )
}

export function Confetti() {
  const { instance, setShowDiscoBall } = useContext(ConfettiContext)

  const handleClick = () => {
    const myConfetti = instance || confetti

    const duration = 5 * 1000
    const animationEnd = Date.now() + duration
    const defaults = { startVelocity: 30, spread: 360, ticks: 60 }

    const randomInRange = (min: number, max: number) =>
      Math.random() * (max - min) + min

    // Show disco ball
    setShowDiscoBall(true)

    const interval = window.setInterval(() => {
      const timeLeft = animationEnd - Date.now()

      if (timeLeft <= 0) {
        clearInterval(interval)
        setShowDiscoBall(false)
        return
      }

      const particleCount = 50 * (timeLeft / duration)
      myConfetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      })
      myConfetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      })
    }, 250)
  }

  return (
    <div className="relative">
      <Button variant="link" size="icon" onClick={handleClick}>
        <motion.img
          src="/confetti-cone.png"
          alt="Confetti cone"
          className="size-8 object-contain cursor-pointer"
          animate={{
            rotate: [0, -10, 10, -10, 10, 0],
          }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
            repeatDelay: 2,
            ease: 'easeInOut',
          }}
          whileHover={{
            scale: 1.1,
            rotate: [0, -15, 15, -15, 15, 0],
            transition: {
              duration: 0.5,
              repeat: Infinity,
              repeatDelay: 2,
              ease: 'easeInOut',
            },
          }}
        />
      </Button>
    </div>
  )
}
