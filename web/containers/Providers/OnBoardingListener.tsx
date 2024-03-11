import { Fragment, PropsWithChildren } from 'react'

import { useAtomValue } from 'jotai'

import Onboarding from '@/containers/OnBoarding'

import { appConfigurationAtom } from '@/helpers/atoms/AppConfig.atom'

const OnBoardingListener = ({ children }: PropsWithChildren) => {
  const appConfig = useAtomValue(appConfigurationAtom)

  if (!appConfig) {
    return <Fragment>{children}</Fragment>
  }

  const shouldShowOnboarding =
    appConfig.finish_onboarding == null || appConfig.finish_onboarding === false

  if (shouldShowOnboarding) {
    return (
      <div className="flex h-screen w-full flex-shrink-0">
        <Onboarding />
      </div>
    )
  }

  return <Fragment>{children}</Fragment>
}

export default OnBoardingListener
