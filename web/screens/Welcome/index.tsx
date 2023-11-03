import LogoMark from '@/containers/Brand/Logo/Mark'

const WelcomeScreen = () => {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center">
        <LogoMark
          className="mx-auto mb-4 animate-wave"
          width={56}
          height={56}
        />
        <h1 data-testid="testid-welcome-title" className="text-2xl font-bold">
          Welcome to Jan
        </h1>
        <p className="">{`let’s download your first model`}</p>
      </div>
    </div>
  )
}

export default WelcomeScreen
