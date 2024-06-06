import React, { useState, useEffect } from 'react'

type Props = {
  text: string
  speed: number
}

const TypingAnimated: React.FC<Props> = ({ text, speed }) => {
  const [displayedText, setDisplayedText] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (index < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(displayedText + text[index])
        setIndex(index + 1)
      }, speed)

      return () => clearTimeout(timeout)
    }
  }, [index, text, displayedText, speed])

  return <span className="line-clamp-1">{displayedText}</span>
}

export default TypingAnimated
