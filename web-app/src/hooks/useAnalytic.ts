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

export type ProductAnalyticPrompState = {
  productAnalyticPrompt: boolean
  setProductAnalyticPrompt: (value: boolean) => void
}

export const useProductAnalyticPrompt = create<ProductAnalyticPrompState>()(
  persist(
    (set) => {
      // Initialize isDark based on OS preference if theme is auto
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
      // Initialize isDark based on OS preference if theme is auto
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
