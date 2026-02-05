import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const useAnalytic = () => {
  const { productAnalyticPrompt, setProductAnalyticPrompt } =
    useProductAnalyticPrompt()
  const { productAnalytic, setProductAnalytic } = useProductAnalytic()

  const updateAnalytic = ({
    productAnalyticPrompt,
    productAnalytic,
  }: {
    productAnalyticPrompt: boolean
    productAnalytic: boolean
  }) => {
    setProductAnalyticPrompt(productAnalyticPrompt)
    setProductAnalytic(productAnalytic)
  }

  return {
    productAnalyticPrompt,
    setProductAnalyticPrompt,
    productAnalytic,
    setProductAnalytic,
    updateAnalytic,
  }
}

export type ProductAnalyticPromptState = {
  productAnalyticPrompt: boolean
  setProductAnalyticPrompt: (value: boolean) => void
}

export const useProductAnalyticPrompt = create<ProductAnalyticPromptState>()(
  persist(
    (set) => {
      const initialState = {
        productAnalyticPrompt: true,
        setProductAnalyticPrompt: async (value: boolean) => {
          set(() => ({ productAnalyticPrompt: value }))
        },
      }

      return initialState
    },
    {
      name: localStorageKey.productAnalyticPrompt,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

export type ProductAnalyticState = {
  productAnalytic: boolean
  setProductAnalytic: (value: boolean) => void
}

export const useProductAnalytic = create<ProductAnalyticState>()(
  persist(
    (set) => {
      const initialState = {
        productAnalytic: false,
        setProductAnalytic: async (value: boolean) => {
          set(() => ({ productAnalytic: value }))
        },
      }

      return initialState
    },
    {
      name: localStorageKey.productAnalytic,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
