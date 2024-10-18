'use client'

import { ApiReferenceReact } from '@scalar/api-reference-react'
import { useTheme } from 'nextra-theme-docs'
import { useIsomorphicLayoutEffect } from '@/hooks/useIsomorphicLayoutEffect'

export const APIReference = () => {
  const { theme, resolvedTheme } = useTheme()

  useIsomorphicLayoutEffect(() => {
    if (theme === 'dark') {
      localStorage.setItem('isDark', 'true')
    } else {
      localStorage.setItem('isDark', 'false')
    }

    if (resolvedTheme === 'dark') {
      localStorage.setItem('isDark', 'true')
    } else {
      localStorage.setItem('isDark', 'false')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, resolvedTheme])

  return (
    <>
      <ApiReferenceReact
        configuration={{
          spec: {
            url: 'https://raw.githubusercontent.com/janhq/docs/main/public/openapi/jan.json',
          },
          theme: 'alternate',
          hideModels: true,
          customCss: '.darklight{display:none!important;}',
        }}
      />
    </>
  )
}

export default APIReference
