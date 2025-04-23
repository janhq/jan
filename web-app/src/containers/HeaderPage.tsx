import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { ReactNode } from '@tanstack/react-router'
import { platform } from '@tauri-apps/plugin-os'

type HeaderPageProps = {
  children: ReactNode
}
const HeaderPage = ({ children }: HeaderPageProps) => {
  const platformName = platform()
  const { open, setLeftPanel } = useLeftPanel()

  return (
    <div
      className={cn(
        'p-2 pt-1.5 border-b border-neutral-800 pl-18',
        platformName === 'macos' && !open ? 'pl-18' : 'pl-4'
      )}
    >
      <div className="flex items-center gap-2">
        {!open && (
          <button onClick={() => setLeftPanel(!open)}>
            <IconLayoutSidebar size={18} className="text-neutral-200" />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

export default HeaderPage
