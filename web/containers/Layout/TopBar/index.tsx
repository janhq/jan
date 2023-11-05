import CommandSearch from '@/containers/Layout/TopBar/CommandSearch'

import { useMainViewState } from '@/hooks/useMainViewState'

const TopBar = () => {
  const { viewStateName } = useMainViewState()

  return (
    <div className="fixed left-0 top-0 z-50 flex h-12 w-full border-b border-border bg-background/50">
      <div className="relative left-16 flex w-[calc(100%-64px)] items-center justify-between space-x-4 px-6">
        <div>
          <span className="font-medium">{viewStateName}</span>
        </div>
        <CommandSearch />
      </div>
    </div>
  )
}

export default TopBar
