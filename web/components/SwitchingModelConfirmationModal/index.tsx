import React, { Fragment } from 'react'

import { Dialog, Transition } from '@headlessui/react'
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'

import { Model } from '@janhq/core/lib/types'
import { useAtom, useAtomValue } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { switchingModelConfirmationModalPropsAtom } from '@/helpers/atoms/Modal.atom'

import { activeAssistantModelAtom } from '@/helpers/atoms/Model.atom'

export type SwitchingModelConfirmationModalProps = {
  replacingModel: Model
}

const SwitchingModelConfirmationModal: React.FC = () => {
  const [props, setProps] = useAtom(switchingModelConfirmationModalPropsAtom)
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { startModel } = useActiveModel()

  const onConfirmSwitchModelClick = () => {
    const modelId = props?.replacingModel._id
    if (modelId) {
      startModel(modelId)
    }
    setProps(undefined)
  }

  return (
    <Transition.Root show={props != null} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-10"
        onClose={() => setProps(undefined)}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    onClick={() => setProps(undefined)}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon
                      className="h-6 w-6 text-red-600"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title
                      as="h3"
                      className="text-base font-semibold leading-6 text-gray-900"
                    >
                      Switching model
                    </Dialog.Title>
                    <div className="mt-2 flex flex-col">
                      <p className="text-sm text-gray-500">
                        Selected conversation is using model{' '}
                        <span className="font-semibold text-black">
                          {props?.replacingModel.name}
                        </span>
                        , but the active model is using{' '}
                        <span className="font-semibold text-black">
                          {activeModel?.name}
                        </span>
                        .
                      </p>
                      <br />
                      <p className="text-sm text-gray-500">
                        Switch to
                        <span className="font-semibold text-black">
                          {' '}
                          {props?.replacingModel.name}?
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto"
                    onClick={onConfirmSwitchModelClick}
                  >
                    Switch
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={() => setProps(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

export default SwitchingModelConfirmationModal
