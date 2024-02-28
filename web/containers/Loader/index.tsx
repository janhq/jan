type Props = {
  description: string
}
export default function Loader({ description }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex h-full items-center justify-center gap-y-4 rounded-lg bg-background/90 backdrop-blur-sm">
      <div className="space-y-16">
        <div className="loader">
          <div className="loader-inner">
            <label className="h-2 w-2 rounded-full bg-blue-500" />
            <label className="h-2 w-2 rounded-full bg-blue-500" />
            <label className="h-2 w-2 rounded-full bg-blue-500" />
            <label className="h-2 w-2 rounded-full bg-blue-500" />
            <label className="h-2 w-2 rounded-full bg-blue-500" />
            <label className="h-2 w-2 rounded-full bg-blue-500" />
          </div>
        </div>
        <p className="font-medium text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
