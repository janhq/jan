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
      </div>
    </div>
  )
}
