type Props = {
  description: string
}
export default function Loader({ description }: Props) {
  return (
    <div className="fixed inset-0 z-[999] flex h-full items-center justify-center gap-y-4 rounded-lg bg-white backdrop-blur dark:bg-gray-950">
      <div className="space-y-16">
        <div className="loader">
          <div className="loader-inner">
            {[...Array(6).keys()].map((i) => {
              return (
                <label className="h-2 w-2 rounded-full bg-blue-600" key={i} />
              )
            })}
          </div>
        </div>
        <p className="font-medium text-black dark:text-white">{description}</p>
      </div>
    </div>
  )
}
