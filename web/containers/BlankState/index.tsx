import LogoMark from '@/containers/Brand/Logo/Mark'

const BlankState = () => {
  return (
    <div className="mx-auto mt-10 flex h-full w-3/4 flex-col items-center justify-center text-center">
      <LogoMark className="mx-auto mb-4 animate-wave" width={48} height={48} />
      <h1 className="text-base font-semibold">Welcome!</h1>
      <p className="mt-1 text-[hsla(var(--text-secondary))]">
        You need to download your first model
      </p>
    </div>
  )
}

export default BlankState
