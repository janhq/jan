export default function AppearanceOptions() {
  return (
    <div className="m-4 block w-full">
      {/* Keyboard shortcut  */}
      <div className="flex w-full items-start justify-between border-b border-[hsla(var(--app-border))] py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="font-semibold capitalize">Theme</h6>
          </div>
          <p className="leading-relaxed"></p>
        </div>
        {/* <ShortcutModal /> */}
      </div>
    </div>
  )
}
