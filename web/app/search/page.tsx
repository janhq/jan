'use client'

import UserInput from './UserInput'

const Search = () => {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[hsla(var(--app-bg))]">
      <div className={'draggable-bar h-[10px]'} />
      <UserInput />
    </div>
  )
}

export default Search
