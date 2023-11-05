import CommandSearch from '@/containers/Layout/TopBar/CommandSearch'

import { useGetAppVersion } from '@/hooks/useGetAppVersion'
import { useMainViewState } from '@/hooks/useMainViewState'

const TopBar = () => {
  const { viewStateName } = useMainViewState()
  const appVersion = useGetAppVersion()
  return (
    <div className="fixed left-0 top-0 z-50 flex h-12 w-full border-b border-border bg-background/50">
      <div className="relative left-16 flex w-[calc(100%-64px)] items-center justify-between px-6">
        <div>
          <span className="font-medium">{viewStateName}</span>
        </div>
        <CommandSearch />
        <div className="flex items-center gap-x-2">
          <span className="text-xs font-semibold text-muted-foreground">
            Jan v{appVersion?.version ?? ''}
          </span>
        </div>
      </div>
    </div>
  )
}

export default TopBar
