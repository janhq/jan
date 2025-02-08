import { Components } from 'react-markdown'

export const markdownComponents: Partial<Components> = {
  a: ({ href, children, ...props }) => (
    <a
      target="_blank"
      href={href}
      className="text-[hsla(var(--app-link))]"
      {...props}
    >
      {children}
    </a>
  ),
}
