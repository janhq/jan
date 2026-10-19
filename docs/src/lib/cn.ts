import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge only knows Tailwind's own sizes, so it reads `text-body` or
// `text-mono-button` as a colour and drops it next to `text-ink`. Register the
// type scale from global.css as font sizes.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'display-md',
        'lead',
        'tagline',
        'card-title',
        'body',
        'body-strong',
        'caption-strong',
        'mono-badge',
        'body-sm',
        'caption',
        'fine-print',
        'mono-button',
        'mono-link',
        'mono-label',
        'mono-nav',
      ],
    },
  },
})

export function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(inputs.filter(Boolean).join(' '))
}
