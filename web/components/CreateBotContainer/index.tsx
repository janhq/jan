/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import React from 'react'

import { SubmitHandler, useForm } from 'react-hook-form'

import { DataService } from '@janhq/core'

import { useSetAtom } from 'jotai'
import { v4 as uuidv4 } from 'uuid'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { executeSerial } from '@/services/pluginService'

import Avatar from '../Avatar'
import CreateBotPromptInput from '../CreateBotPromptInput'
import DraggableProgressBar from '../DraggableProgressBar'
import DropdownBox from '../DropdownBox'
import PrimaryButton from '../PrimaryButton'
import TextAreaWithTitle from '../TextAreaWithTitle'
import TextInputWithTitle from '../TextInputWithTitle'
import ToggleSwitch from '../ToggleSwitch'

import { activeBotAtom } from '@/helpers/atoms/Bot.atom'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@/helpers/atoms/MainView.atom'
import { rightSideBarExpandStateAtom } from '@/helpers/atoms/SideBarExpand.atom'

const CreateBotContainer: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const setActiveBot = useSetAtom(activeBotAtom)
  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const setRightSideBarVisibility = useSetAtom(rightSideBarExpandStateAtom)

  const createBot = async (bot: Bot) => {
    try {
      // await executeSerial(DataService.CreateBot, bot)
    } catch (err) {
      alert(err)
      console.error(err)
    } finally {
      setMainViewState(MainViewState.BotInfo)
      setActiveBot(bot)
      setRightSideBarVisibility(true)
    }
  }

  const { handleSubmit, control } = useForm<Bot>({
    defaultValues: {
      _id: uuidv4(),
      name: '',
      description: '',
      visibleFromBotProfile: true,
      systemPrompt: '',
      welcomeMessage: '',
      publiclyAccessible: true,
      suggestReplies: false,
      renderMarkdownContent: true,
      customTemperature: 0.7,
      enableCustomTemperature: false,
      maxTokens: 2048,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    mode: 'onChange',
  })

  const onSubmit: SubmitHandler<Bot> = (data) => {
    console.log('bot', JSON.stringify(data, null, 2))
    if (!data.modelId) {
      alert('Please select a model')
      return
    }
    const bot: Bot = {
      ...data,
      customTemperature: Number(data.customTemperature),
      maxTokens: Number(data.maxTokens),
      frequencyPenalty: Number(data.frequencyPenalty),
      presencePenalty: Number(data.presencePenalty),
    }
    createBot(bot)
  }

  let models = downloadedModels.map((model: { _id: any }) => {
    return model._id
  })

  models = ['Select a model', ...models]

  return (
    <form
      className="flex h-full w-full flex-col"
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="mx-6 mt-3 flex items-center justify-between gap-3">
        <span className="text-lg font-bold">Create Bot</span>
        <div className="flex gap-3">
          <PrimaryButton isSubmit title="Create" />
        </div>
      </div>
      <div className="scroll flex flex-1 flex-col overflow-y-auto pt-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <Avatar allowEdit />

          <TextInputWithTitle
            description="Bot name should be unique, 4-20 characters long, and may include alphanumeric characters, dashes or underscores."
            title="Bot name"
            id="name"
            control={control}
            required={true}
          />

          <TextAreaWithTitle
            id="description"
            title="Bot description"
            placeholder="Optional"
            control={control}
          />

          <div className="flex flex-col pb-2">
            <DropdownBox
              id="modelId"
              title="Model"
              data={models}
              control={control}
              required={true}
            />
          </div>

          <CreateBotPromptInput id="systemPrompt" control={control} required />

          <div className="flex flex-col gap-0.5">
            <label className="block">Bot access</label>
            <span className="text-muted-foreground mb-4 mt-1">
              If this setting is enabled, the bot will be added to your profile
              and will be publicly accessible. Turning this off will make the
              bot private.
            </span>

            <ToggleSwitch
              id="publiclyAccessible"
              title="Bot publicly accessible"
              control={control}
            />
            <DraggableProgressBar
              id="maxTokens"
              control={control}
              min={0}
              max={4096}
              step={1}
            />
            <p>Custom temperature</p>
            <DraggableProgressBar
              id="customTemperature"
              control={control}
              min={0}
              max={1}
              step={0.01}
            />
            <p>Frequency penalty</p>
            <DraggableProgressBar
              id="frequencyPenalty"
              control={control}
              min={0}
              max={1}
              step={0.01}
            />
            <p>Presence penalty</p>
            <DraggableProgressBar
              id="presencePenalty"
              control={control}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
        </div>
      </div>
    </form>
  )
}

export default CreateBotContainer
