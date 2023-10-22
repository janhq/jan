import { activeBotAtom } from '@helpers/atoms/Bot.atom'
import { showingBotListModalAtom } from '@helpers/atoms/Modal.atom'
import useGetBots from '@hooks/useGetBots'
import { Dialog, Transition } from '@headlessui/react'
import { useAtom } from 'jotai'
import React, { Fragment, useEffect, useState } from 'react'

const BotListModal: React.FC = () => {
  const [open, setOpen] = useAtom(showingBotListModalAtom)
  const [bots, setBots] = useState<Bot[]>([])
  const [activeBot, setActiveBot] = useAtom(activeBotAtom)
  const { getAllBots } = useGetBots()

  useEffect(() => {
    getAllBots().then((res) => {
      setBots(res)
    })
  }, [open])

  const onBotSelected = (bot: Bot) => {
    if (bot._id !== activeBot?._id) {
      setActiveBot(bot)
    }
    setOpen(false)
  }

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={setOpen}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-sm sm:p-6">
                <div className="overflow-hidden bg-white shadow sm:rounded-md">
                  <ul role="list" className="divide-y divide-gray-200">
                    {bots.map((bot) => (
                      <li
                        role="button"
                        key={bot._id}
                        className="px-4 py-4 sm:px-6"
                        onClick={() => onBotSelected(bot)}
                      >
                        <p>{bot.name}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

export default BotListModal
