import { Button } from '@janhq/uikit'
import { LayoutGridIcon } from 'lucide-react'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

export default function BlankStateMyModel() {
  const { setMainViewState } = useMainViewState()
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center">
        <LayoutGridIcon size={32} className="mx-auto text-primary" />
        <div className="mt-4">
          <h1 className="text-2xl font-bold leading-snug">{`Ups, You don't have a model.`}</h1>
          <p className="mt-1 text-base">{`let’s download your first model`}</p>
          <Button
            className="mt-4"
            onClick={() => setMainViewState(MainViewState.ExploreModel)}
          >
            Explore Models
          </Button>
        </div>
      </div>
    </div>
  )
}
