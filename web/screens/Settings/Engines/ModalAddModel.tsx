import { memo, ReactNode, useState } from 'react'

import { useForm } from 'react-hook-form'

import Image from 'next/image'

import { zodResolver } from '@hookform/resolvers/zod'

import { InferenceEngine, Model } from '@janhq/core'

import { Button, Input, Modal } from '@janhq/joi'
import { useAtomValue } from 'jotai'
import { PlusIcon, ArrowUpRightFromSquare } from 'lucide-react'

import { z } from 'zod'

import {
  addRemoteEngineModel,
  useGetEngines,
  useGetRemoteModels,
} from '@/hooks/useEngineManagement'

import { getLogoEngine, getTitleByEngine } from '@/utils/modelEngine'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const modelSchema = z.object({
  modelName: z.string().min(1, 'Model name is required'),
})

const ModelAddModel = ({ engine }: { engine: string }) => {
  const [open, setOpen] = useState(false)
  const { mutate: mutateListEngines } = useGetRemoteModels(engine)
  const { engines } = useGetEngines()
  const models = useAtomValue(downloadedModelsAtom)
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm({
    resolver: zodResolver(modelSchema),
    defaultValues: {
      modelName: '',
    },
  })

  const onSubmit = async (data: z.infer<typeof modelSchema>) => {
    if (models.some((e: Model) => e.id === data.modelName)) {
      setError('modelName', {
        type: 'manual',
        message: 'Model already exists',
      })
      return
    }
    await addRemoteEngineModel(data.modelName, engine)
    mutateListEngines()

    setOpen(false)
  }

  // Helper to render labels with asterisks for required fields
  const renderLabel = (
    prefix: ReactNode,
    label: string,
    isRequired: boolean,
    desc?: string
  ) => (
    <>
      <span className="flex flex-row items-center gap-1">
        {prefix}
        {label}
      </span>
      <p className="mt-4 font-normal text-[hsla(var(--text-secondary))]">
        {desc}
        {isRequired && <span className="text-red-500">*</span>}
      </p>
    </>
  )

  return (
    <Modal
      title={
        <div>
          <p>Add Model</p>
        </div>
      }
      fullPage
      open={open}
      onOpenChange={() => setOpen(!open)}
      trigger={
        <Button>
          <PlusIcon className="mr-2" size={14} />
          Add Model
        </Button>
      }
      className="w-[500px]"
      content={
        <div>
          <form className="mt-4 space-y-6" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <label htmlFor="modelName" className="font-semibold">
                {renderLabel(
                  getLogoEngine(engine as InferenceEngine) ? (
                    <Image
                      src={getLogoEngine(engine as InferenceEngine) ?? ''}
                      width={40}
                      height={40}
                      alt="Engine logo"
                      className="h-5 w-5 flex-shrink-0"
                    />
                  ) : (
                    <></>
                  ),
                  getTitleByEngine(engine as InferenceEngine) ?? engine,
                  false,
                  'Model ID'
                )}
              </label>
              <Input placeholder="Enter model ID" {...register('modelName')} />
              {errors.modelName && (
                <p className="text-sm text-red-500">
                  {errors.modelName.message}
                </p>
              )}
              <div className="pt-2">
                <a
                  target="_blank"
                  href={
                    engines?.[engine as InferenceEngine]?.[0]?.metadata
                      ?.explore_models_url ??
                    engines?.[engine as InferenceEngine]?.[0]?.url
                  }
                  className="flex flex-row items-center gap-1 font-medium text-[hsla(var(--app-link))] no-underline"
                >
                  See model list from{' '}
                  {getTitleByEngine(engine as InferenceEngine)}
                  <ArrowUpRightFromSquare size={13} />
                </a>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-x-2">
              <Button
                theme="ghost"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </div>
          </form>
        </div>
      }
    />
  )
}

export default memo(ModelAddModel)
