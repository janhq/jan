import React from 'react'

import { Button } from '@janhq/uikit'
import { useSetAtom } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const EmptyModel: React.FC = () => {
  const setMainViewState = useSetAtom(mainViewStateAtom)

  return (
    <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center text-center">
      <LogoMark className="mx-auto mb-4 animate-wave" width={56} height={56} />
      <h1 className="text-2xl font-bold">Welcome!</h1>
      <p className="mt-1 text-base">You need to download your first model</p>
      <Button
        className="mt-4"
        onClick={() => setMainViewState(MainViewState.Hub)}
      >
        Explore The Hub
      </Button>
    </div>
  )
}

export default React.memo(EmptyModel)
