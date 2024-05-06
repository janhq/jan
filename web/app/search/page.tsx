'use client'

import UserInput from './UserInput'

const Search: React.FC = () => {
  return (
    <div className="h-screen w-screen overflow-hidden bg-white dark:bg-[hsla(var(--app-bg))]">
      <UserInput />
    </div>
  )
}

export default Search
