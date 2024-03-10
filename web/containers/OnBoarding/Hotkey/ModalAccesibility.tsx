import React from 'react'

import { useTheme } from 'next-themes'

import {
  Modal,
  ModalPortal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
} from '@janhq/uikit'
import { useAtom } from 'jotai'

import { modalOnboardingAccesibilityAtom, onBoardingStepAtom } from '..'

const ModalAccesibility = () => {
  const [accessibilityCheckbox, setAccessibilityCheckbox] = useAtom(
    modalOnboardingAccesibilityAtom
  )
  const [onBoardingStep, setOnBoardingStep] = useAtom(onBoardingStepAtom)
  const { resolvedTheme } = useTheme()
  return (
    <Modal open={accessibilityCheckbox} onOpenChange={setAccessibilityCheckbox}>
      <ModalPortal />
      <ModalContent>
        <div className="text-center">
          <h6 className="mb-2 text-xl font-bold">
            Enable Accessibility Permissions
          </h6>
          <p className="leading-relaxed">
            You can always enable it later. Open <b>System Settings</b>, then
            follow these steps to <b>enable Accessibility</b> for Jan:
          </p>
          <div className="mt-6">
            <img
              src={
                resolvedTheme === 'dark'
                  ? 'images/enable-accessibility-dark.png'
                  : 'images/enable-accessibility.png'
              }
              alt="enable-accessibility"
            />
          </div>
        </div>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild>
              <Button
                autoFocus
                onClick={() => setOnBoardingStep(onBoardingStep + 1)}
              >
                Got it
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default React.memo(ModalAccesibility)
