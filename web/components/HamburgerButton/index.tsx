'use client'

import React from 'react'

import { Bars3Icon } from '@heroicons/react/24/outline'

import { useSetAtom } from 'jotai'

import { showingMobilePaneAtom } from '@/helpers/atoms/Modal.atom'

const HamburgerButton: React.FC = () => {
  const setShowingMobilePane = useSetAtom(showingMobilePaneAtom)
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center self-end rounded-md p-1 text-gray-700 lg:hidden"
      onClick={() => setShowingMobilePane(true)}
    >
      <span className="sr-only">Open main menu</span>
      <Bars3Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  )
}

export default React.memo(HamburgerButton)
