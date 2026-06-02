import { useState } from 'react'
import { cn } from '@/lib/utils'
import { modelFamilyLogoSrc } from '@/lib/model-logo'

/**
 * Publisher logo for a model. Shows the bundled brand logo for the model family
 * (Gemma, Qwen, …) when recognized, otherwise the first letter of the
 * author/name. No remote avatars are fetched.
 */
type ModelLogoProps = {
  author?: string
  name?: string
  className?: string
}

export function ModelLogo({ author, name, className }: ModelLogoProps) {
  const familyLogo = modelFamilyLogoSrc(name)
  const [failed, setFailed] = useState(false)
  const showLogo = !!familyLogo && !failed
  const letter = (author || name || '?').charAt(0).toUpperCase()

  return (
    <div
      className={cn(
        'size-[46px] rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-secondary text-muted-foreground font-semibold text-sm border border-border',
        className
      )}
      title={author || ''}
    >
      {showLogo ? (
        <img
          src={familyLogo}
          alt={author || ''}
          className="size-full rounded-md object-contain p-1"
          onError={() => setFailed(true)}
        />
      ) : (
        letter
      )}
    </div>
  )
}
