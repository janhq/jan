export default function ShortCut(props: { menu: string }) {
  const { menu } = props
  const symbol = isMac ? '⌘' : 'Ctrl + '

  return (
    <div className="text-[hsla(var(--text-secondary)] bg-secondary inline-flex items-center justify-center rounded-full px-1 py-0.5 text-xs font-bold">
      <p>{symbol + menu}</p>
    </div>
  )
}
