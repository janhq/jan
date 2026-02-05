import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import {
  LinkedinShareButton,
  LinkedinIcon,
  TwitterShareButton,
  XIcon,
} from 'react-share'

const SocialShareButton = () => {
  const [url, setUrl] = useState('')
  const pathname = usePathname()

  useEffect(() => {
    if (window !== undefined) {
      setUrl(window.location.origin + pathname)
    }
  }, [pathname])

  return (
    <div className="mt-4 space-x-2">
      <TwitterShareButton url={url}>
        <XIcon round size={38} />
      </TwitterShareButton>
      <LinkedinShareButton url={url}>
        <LinkedinIcon round size={38} />
      </LinkedinShareButton>
    </div>
  )
}

export default SocialShareButton
