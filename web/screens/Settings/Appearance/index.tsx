import ToggleAccent from '@/screens/Settings/Appearance/TogglePrimary'
import ToggleTheme from '@/screens/Settings/Appearance/ToggleTheme'

export default function AppearanceOptions() {
  return (
    <div className="block w-full">
      <div className="flex w-full items-center justify-between border-b border-border py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1">
          <h6 className="text-sm font-semibold capitalize">Themes</h6>
          <p className="leading-relaxed ">Choose your default theme.</p>
        </div>
        <ToggleTheme />
      </div>
      <div className="flex w-full items-center justify-between border-b border-border py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1">
          <h6 className="text-sm font-semibold capitalize">Primary color</h6>
          <p className="leading-relaxed ">Choose your primary color.</p>
        </div>
        <ToggleAccent />
      </div>
    </div>
  )
}
