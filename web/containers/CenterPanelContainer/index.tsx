import { PropsWithChildren } from 'react'

const CenterPanelContainer = ({ children }: PropsWithChildren) => {
  return (
    <div className="h-full w-full bg-[hsla(var(--center-panel-bg))]">
      {children}
    </div>
  )
}

export default CenterPanelContainer
