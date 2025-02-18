import { memo, useState } from 'react'
import { useForm } from 'react-hook-form'

import { zodResolver } from '@hookform/resolvers/zod'

import { Button, Input, Modal, TextArea } from '@janhq/joi'
import { PlusIcon } from 'lucide-react'
import { z } from 'zod'

import { addRemoteEngine, useGetEngines } from '@/hooks/useEngineManagement'

const engineSchema = z.object({
  engineName: z.string().min(1, 'Engine name is required'),
  modelListUrl: z
    .string()
    .url('Enter a valid Model List URL')
    .or(z.literal('')),
  headerTemplate: z.string().optional(),
  chatCmpletionsUrl: z
    .string()
    .url('Enter a valid Model List URL')
    .or(z.literal('')),
  apiKey: z.string().optional(),
  requestFormat: z.string().optional(),
  responseFormat: z.string().optional(),
})

const ModalAddRemoteEngine = () => {
  const [open, setOpen] = useState(false)
  const { mutate: mutateListEngines } = useGetEngines()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(engineSchema),
    defaultValues: {
      engineName: '',
      chatCmpletionsUrl: '',
      modelListUrl: '',
      headerTemplate: '',
      apiKey: '',
      requestFormat: '',
      responseFormat: '',
    },
  })

  const onSubmit = async (data: z.infer<typeof engineSchema>) => {
    await addRemoteEngine({
      type: 'remote',
      engine: data.engineName,
      url: ' ',
      api_key: data.apiKey,
      metadata: {
        header_template: data.headerTemplate,
        get_models_url: data.modelListUrl,
        transform_req: {
          chat_completions: {
            template: data.requestFormat,
            url: data.chatCmpletionsUrl,
          },
        },
        transform_resp: {
          chat_completions: {
            template: data.requestFormat,
          },
        },
      },
    })
    mutateListEngines()

    setOpen(false)
  }

  // Helper to render labels with asterisks for required fields
  const renderLabel = (label: string, isRequired: boolean, desc?: string) => (
    <>
      <span>
        {label} {isRequired && <span className="text-red-500">*</span>}
      </span>
      <p className="mt-1 font-normal text-[hsla(var(--text-secondary))]">
        {desc}
      </p>
    </>
  )

  return (
    <Modal
      title={
        <div>
          <p>Install Remote Engine</p>
          <p className="text-sm font-normal text-[hsla(var(--text-secondary))]">
            Only OpenAI API-compatible engines are supported.
          </p>
        </div>
      }
      fullPage
      open={open}
      onOpenChange={() => setOpen(!open)}
      trigger={
        <Button>
          <PlusIcon className="mr-2" size={14} />
          Install Engine
        </Button>
      }
      content={
        <div>
          <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <label htmlFor="engineName" className="font-semibold">
                {renderLabel('Engine Name', true)}
              </label>
              <Input
                placeholder="Enter engine name"
                {...register('engineName')}
              />
              {errors.engineName && (
                <p className="text-sm text-red-500">
                  {errors.engineName.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="chatCmpletionsUrl" className="font-semibold">
                {renderLabel(
                  'Chat Completions URL',
                  false,
                  `The URL where Jan sends requests to access the AI provider's API.`
                )}
              </label>
              <Input
                placeholder="Enter Chat Completions Endpoint URL"
                {...register('chatCmpletionsUrl')}
              />
              {errors.chatCmpletionsUrl && (
                <p className="text-sm text-red-500">
                  {errors.chatCmpletionsUrl.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="modelListUrl" className="font-semibold">
                {renderLabel(
                  'Model List URL',
                  false,
                  `The endpoint URL to fetch available models.`
                )}
              </label>
              <Input
                placeholder="Enter model list URL"
                {...register('modelListUrl')}
              />
              {errors.modelListUrl && (
                <p className="text-sm text-red-500">
                  {errors.modelListUrl.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="apiKey" className="font-semibold">
                {renderLabel(
                  'API Key',
                  false,
                  `Your authentication key to activate this engine.`
                )}
              </label>
              <Input
                placeholder="Enter API Key"
                type="password"
                {...register('apiKey')}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="headerTemplate" className="font-semibold">
                {renderLabel(
                  'Request Headers Template',
                  false,
                  `HTTP headers template required for API authentication and version specification.`
                )}
              </label>
              <TextArea
                placeholder="Enter conversion function"
                {...register('headerTemplate')}
              />
              {errors.headerTemplate && (
                <p className="text-sm text-red-500">
                  {errors.headerTemplate.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="requestFormat" className="font-semibold">
                {renderLabel(
                  'Request Format Conversion',
                  false,
                  `Template to transform OpenAI-compatible requests into provider-specific format.`
                )}
              </label>
              <TextArea
                placeholder="Enter conversion function"
                {...register('requestFormat')}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="responseFormat" className="font-semibold">
                {renderLabel(
                  'Response Format Conversion',
                  false,
                  `Template to transform provider responses into OpenAI-compatible format.`
                )}
              </label>
              <TextArea
                placeholder="Enter conversion function"
                {...register('responseFormat')}
              />
            </div>

            <div className="mt-8 flex justify-end gap-x-2">
              <Button
                theme="ghost"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Install</Button>
            </div>
          </form>
        </div>
      }
    />
  )
}

export default memo(ModalAddRemoteEngine)
