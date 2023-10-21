import React from 'react'
import CompactLogo from '@containers/Logo/CompactLogo'

const WelcomeScreen = () => {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div>
        <CompactLogo width={40} height={40} />
        <h1 className="text-6xl font-bold leading-snug">Welcome to Jan</h1>
        <p className="text-xl tracking-wide text-gray-600 dark:text-gray-400">{`let’s download your first model`}</p>
      </div>
    </div>
  )
}

export default WelcomeScreen
