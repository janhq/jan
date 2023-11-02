import React from 'react'

import HamburgerButton from '../HamburgerButton'
import LoginButton from '../LoginButton'

const Header: React.FC = () => {
  return (
    <header className="flex border-b-[1px] border-gray-200 p-3 dark:bg-gray-800">
      <nav className="flex-1 justify-center">
        <HamburgerButton />
      </nav>
      <div className="h-[30px]" />
      <LoginButton />
    </header>
  )
}

export default Header
