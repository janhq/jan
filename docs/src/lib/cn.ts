import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge only knows Tailwind's own sizes, so it reads `text-doc-body`
// or `text-mono-button` as a colour and drops it next to `text-ink`. Register the
// type scale from global.css as font sizes.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'doc-display',
        'doc-title',
        'doc-h2',
        'doc-h3',
        'doc-body',
        'doc-small',
        'doc-label',
        'mono-button',
      ],
    },
  },
})

export function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(inputs.filter(Boolean).join(' '))
}
