import { Marked, Renderer } from 'marked'

export const markdownParser: Marked = new Marked({
  renderer: {
    link: (href, title, text) =>
      Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        ),
  },
})
