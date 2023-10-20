import Image from 'next/image'
import { useSetAtom } from 'jotai'
import {
  setMainViewStateAtom,
  MainViewState,
} from '@/_helpers/atoms/MainView.atom'
import SecondaryButton from '../SecondaryButton'

const Welcome: React.FC = () => {
  const setMainViewState = useSetAtom(setMainViewStateAtom)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-start justify-center gap-5 px-[200px]">
        <Image src={'icons/Jan_AppIcon.svg'} width={44} height={45} alt="" />
        <span className="text-5xl font-semibold text-gray-500">
          Welcome,
          <br />
          let’s download your first model
        </span>
        <SecondaryButton
          title={'Explore models'}
          onClick={() => setMainViewState(MainViewState.ExploreModel)}
        />
      </div>
    </div>
  )
}

export default Welcome
