import { useState } from 'react'
import { cn } from '@/lib/utils'
import { isMonochromeFamilyLogo, modelFamilyLogoSrc } from '@/lib/model-logo'

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
  // Single-color marks are drawn with `fill="currentColor"`, so an <img> would
  // paint them black and lose them on dark backgrounds. Tint via CSS mask so
  // they inherit the (theme-aware) text color, like the letter they replace.
  const mono = !!familyLogo && isMonochromeFamilyLogo(familyLogo)

  return (
    <div
      className={cn(
        'size-[46px] rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-secondary text-muted-foreground font-semibold text-sm border border-border dark:bg-input/30 dark:border-input',
        className
      )}
      title={author || ''}
    >
      {showLogo ? (
        mono ? (
          <span
            role="img"
            aria-label={author || ''}
            className="size-full text-foreground"
            style={{
              backgroundColor: 'currentColor',
              maskImage: `url(${familyLogo})`,
              WebkitMaskImage: `url(${familyLogo})`,
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
              maskPosition: 'center',
              WebkitMaskPosition: 'center',
              maskSize: '72%',
              WebkitMaskSize: '72%',
            }}
          />
        ) : (
          <img
            src={familyLogo}
            alt={author || ''}
            className="size-full rounded-md object-contain p-1"
            onError={() => setFailed(true)}
          />
        )
      ) : (
        letter
      )}
    </div>
  )
}
