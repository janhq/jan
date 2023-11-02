import React from 'react'

import Image from 'next/image'

import { useAtomValue, useSetAtom } from 'jotai'

import {
  MainViewState,
  getMainViewStateAtom,
  setMainViewStateAtom,
} from '@/helpers/atoms/MainView.atom'

type Props = {
  title: string
  viewState: MainViewState
  iconName: string
}

const SidebarMenuItem: React.FC<Props> = ({ title, viewState, iconName }) => {
  const currentState = useAtomValue(getMainViewStateAtom)
  const setMainViewState = useSetAtom(setMainViewStateAtom)

  let className =
    'text-gray-600 hover:text-indigo-600 hover:bg-gray-50 group flex gap-x-3 rounded-md text-base py-2 px-3 w-full'
  if (currentState == viewState) {
    className =
      'bg-gray-100 text-indigo-600 group flex gap-x-3 rounded-md text-base py-2 px-3 w-full'
  }

  const onClick = () => {
    setMainViewState(viewState)
  }

  return (
    <li key={title}>
      <button onClick={onClick} className={className}>
        <Image src={`icons/${iconName}.svg`} width={24} height={24} alt="" />
        <span className="truncate">{title}</span>
      </button>
    </li>
  )
}

export default SidebarMenuItem
