type Props = {
  description: string
}
export default function Loader({ description }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex h-full items-center justify-center gap-y-4 rounded-lg bg-[hsla(var(--app-bg))]/90 backdrop-blur-sm">
      <div className="space-y-16">
        <div className="loader">
          <div className="loader-inner">
            <label className="h-2 w-2 rounded-full bg-primary" />
            <label className="h-2 w-2 rounded-full bg-primary" />
            <label className="h-2 w-2 rounded-full bg-primary" />
            <label className="h-2 w-2 rounded-full bg-primary" />
            <label className="h-2 w-2 rounded-full bg-primary" />
            <label className="h-2 w-2 rounded-full bg-primary" />
          </div>
        </div>
        <p className="text-[hsla(var(--app-text-secondary)] font-medium">
          {description}
        </p>
      </div>
    </div>
  )
}
