export default function ShortCut(props: { menu: string }) {
  const { menu } = props
  const symbol = isMac ? '⌘' : 'Ctrl + '

  return (
    <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
      <p>{symbol + menu}</p>
    </div>
  )
}
