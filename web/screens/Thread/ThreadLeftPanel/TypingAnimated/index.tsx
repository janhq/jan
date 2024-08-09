import React, { useState, useEffect } from 'react'

type Props = {
  text: string
  speed: number
}

const TypingAnimated: React.FC<Props> = ({ text, speed }) => {
  const [displayedText, setDisplayedText] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const typingEffect = setInterval(() => {
      if (text.length) {
        setDisplayedText(text.substring(0, index + 1))
        setIndex(index + 1)
      } else {
        clearInterval(typingEffect)
      }
    }, speed)

    return () => {
      clearInterval(typingEffect)
    }
  }, [index, speed, text])

  return (
    <span className="line-clamp-1 group-hover/message:pr-6">
      {displayedText}
    </span>
  )
}

export default TypingAnimated
