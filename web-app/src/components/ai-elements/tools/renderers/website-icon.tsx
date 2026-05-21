import { Globe } from 'lucide-react'
import { useMemo, useState } from 'react'

type WebsiteIconProps = {
  url?: string
  domain?: string
  size?: number
  className?: string
}

function getFaviconUrl(url?: string, domain?: string) {
  try {
    const hostname = domain ?? (url ? new URL(url).hostname : undefined)
    if (!hostname) return undefined

    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return undefined
  }
}

export function WebsiteIcon({
  url,
  domain,
  size = 16,
  className,
}: WebsiteIconProps) {
  const [failed, setFailed] = useState(false)

  const faviconUrl = useMemo(() => getFaviconUrl(url, domain), [url, domain])

  if (!faviconUrl || failed) {
    return (
      <div className={className} style={{ width: size, height: size }}>
        <Globe className="size-full text-muted-foreground/70" />
      </div>
    )
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      width={size}
      height={size}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
