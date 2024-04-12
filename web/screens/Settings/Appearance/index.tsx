import ShortcutModal from '@/containers/ShortcutModal'

import ToggleAccent from '@/screens/Settings/Appearance/TogglePrimary'
import ToggleTheme from '@/screens/Settings/Appearance/ToggleTheme'

export default function AppearanceOptions() {
  return (
    <div className="m-4 block w-full">
      <div className="flex w-full items-center justify-between border-b border-border py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1">
          <h6 className="text-sm font-semibold capitalize">
            Base color scheme
          </h6>
          <p className="leading-relaxed ">
            Choose between light and dark modes.
          </p>
        </div>
        <ToggleTheme />
      </div>
      <div className="flex w-full items-center justify-between border-b border-border py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1">
          <h6 className="text-sm font-semibold capitalize">Accent Color</h6>
          <p className="leading-relaxed ">
            Choose the primary accent color used throughout the app.
          </p>
        </div>
        <ToggleAccent />
      </div>
      {/* Keyboard shortcut  */}
      <div className="flex w-full items-start justify-between border-b border-border py-3 first:pt-4 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Keyboard Shortcuts
            </h6>
          </div>
          <p className="leading-relaxed">
            Shortcuts that you might find useful in Jan app.
          </p>
        </div>
        <ShortcutModal />
      </div>
    </div>
  )
}
