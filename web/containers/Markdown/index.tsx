import { Marked, Renderer } from 'marked'
import '@/styles/components/marked.scss'
import { twMerge } from 'tailwind-merge'

const marked: Marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link: (href, title, text) => {
      return Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        )
    },
  },
})

const MarkdownText = ({
  text,
  className,
}: {
  text?: string
  className?: string
}) => {
  return (
    <div
      className={twMerge(
        'markdown-content font-medium leading-relaxed text-[hsla(var(--text-secondary))]',
        className
      )}
      dangerouslySetInnerHTML={{
        __html: marked.parse(text ?? '', {
          async: false,
        }),
      }}
    />
  )
}

export default MarkdownText
