import { PropsWithChildren } from 'react'

const CenterPanelContainer = ({ children }: PropsWithChildren) => {
  return (
    <div className="flex h-full w-full px-2">
      <div className="h-full w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--center-panel-bg))] shadow">
        {children}
      </div>
    </div>
  )
}

export default CenterPanelContainer
