import { useReducer } from 'react'

import { Button, CommandModal, Input, Modal, ModalContent } from '@janhq/uikit'

interface HuggingFaceModalState {
  repoID: string
  loading: boolean
  fetchError?: Error
  repoData?: {
    id: string
    tags: Array<'transformers' | 'pytorch' | 'safetensors' | string>
    siblings: {
      rfilename: string
    }[]
    createdAt: string // ISO 8601 timestamp
  }
  unsupported?: boolean
}

type HuggingFaceModalAction =
  | {
      type: 'setRepoID'
      payload: string
    }
  | {
      type: 'setLoading'
      payload: boolean
    }
  | {
      type: 'setRepoData'
      payload: HuggingFaceModalState['repoData']
    }
  | {
      type: 'setFetchError'
      payload: Error
    }
  | {
      type: 'reset'
    }

const reducer = (
  state: HuggingFaceModalState,
  action: HuggingFaceModalAction
) => {
  switch (action.type) {
    case 'setRepoID':
      return {
        ...state,
        repoID: action.payload,
      }
    case 'setLoading':
      return {
        ...state,
        loading: action.payload,
      }
    case 'setRepoData':
      return {
        ...state,
        repoData: action.payload,
        unsupported:
          !action.payload?.tags.includes('transformers') ||
          (!action.payload?.tags.includes('pytorch') &&
            !action.payload?.tags.includes('safetensors')),
      }
    case 'setFetchError':
      return {
        ...state,
        fetchError: action.payload,
      }
    case 'reset':
      return {
        repoID: '',
        loading: false,
      }
  }
}

const HuggingFaceModal = ({
  ...props
}: Omit<Parameters<typeof CommandModal>[0], 'children'>) => {
  const [state, dispatch] = useReducer(reducer, {
    repoID: '',
    loading: false,
  })

  const getRepoData = async () => {
    dispatch({
      type: 'setLoading',
      payload: true,
    })
    try {
      const res = await fetch(
        `https://huggingface.co/api/models/${state.repoID}`
      )
      const data = await res.json()
      dispatch({
        type: 'setRepoData',
        payload: data,
      })
    } catch (err) {
      dispatch({
        type: 'setFetchError',
        payload: err as Error,
      })
    }
    dispatch({
      type: 'setLoading',
      payload: false,
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      getRepoData()
    }
  }

  return (
    <Modal
      {...props}
      onOpenChange={(open) => {
        if (open === false) {
          dispatch({
            type: 'reset',
          })
        }
        if (props.onOpenChange) {
          props.onOpenChange(open)
        }
      }}
    >
      <ModalContent className="hugging-face-modal-content">
        <div className="px-2 py-3">
          <div className="flex w-full flex-col items-center justify-center gap-4 p-4">
            {state.repoData !== undefined ? (
              <>
                <div className="flex flex-col items-center justify-center gap-1">
                  <p className="text-2xl font-bold">Hugging Face Convertor</p>
                  <p className="text-gray">Found the repository!</p>
                </div>
                <div className="flex flex-col items-center justify-center gap-1">
                  <p className="font-bold">{state.repoData.id}</p>
                  <p>
                    {state.unsupported
                      ? '❌ This model is not supported!'
                      : '✅ This model is supported!'}
                  </p>
                  {state.repoData.tags.includes('gguf') ? (
                    <p>...But you can import it manually!</p>
                  ) : null}
                </div>
                <Button
                  // onClick={}
                  className="w-full"
                  loading={state.loading}
                  disabled={state.unsupported}
                  themes={state.loading ? 'ghost' : 'primary'}
                >
                  {state.loading ? '' : 'Convert'}
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center justify-center gap-1">
                  <p className="text-2xl font-bold">Hugging Face Convertor</p>
                  <p className="text-gray">Type the repository id below</p>
                </div>
                <Input
                  placeholder="e.g. username/repo-name"
                  className="bg-white dark:bg-background"
                  onChange={(e) => {
                    dispatch({
                      type: 'setRepoID',
                      payload: e.target.value,
                    })
                  }}
                  onKeyDown={onKeyDown}
                />
                <Button
                  onClick={getRepoData}
                  className="w-full"
                  loading={state.loading}
                  themes={state.loading ? 'ghost' : 'primary'}
                >
                  {state.loading ? '' : 'OK'}
                </Button>
              </>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { HuggingFaceModal }
