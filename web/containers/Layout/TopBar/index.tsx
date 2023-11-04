import { useMainViewState } from '@/hooks/useMainViewState'

const TopBar = () => {
  const { viewStateName } = useMainViewState()
  return (
    <div className="fixed left-0 top-0 z-50 flex h-8 w-full justify-between border-b border-border bg-background/50">
      <div className="relative left-16 flex w-full items-center px-4">
        <span className="text-xs font-bold">{viewStateName}</span>
      </div>
    </div>
  )
}

export default TopBar
