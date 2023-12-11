import { useOs, type OS } from '@/hooks/useOs'

export default function ShortCut(props: { menu: string }) {
  const os = useOs()
  const { menu } = props
  const getSymbol = (os: OS) => {
    switch (os) {
      case 'macos':
        return '⌘'

      default:
        return 'Ctrl'
    }
  }

  return (
    <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
      <p>{getSymbol(os) + ' + ' + menu}</p>
    </div>
  )
}
