import React, { ReactNode, useEffect, useCallback } from "react"
import i18next, { loadTranslations } from "./setup"
import { useGeneralSetting } from "@/hooks/useGeneralSetting"
import { TranslationContext } from "./context"

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Get the current language from general settings
	const { currentLanguage } = useGeneralSetting()

	// Load translations once when the component mounts
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	// Update language when currentLanguage changes
	useEffect(() => {
		if (currentLanguage) {
			i18next.changeLanguage(currentLanguage)
		}
	}, [currentLanguage])

	// Memoize the translation function to prevent unnecessary re-renders
	const translate = useCallback(
		(key: string, options?: Record<string, unknown>) => {
			return i18next.t(key, options)
		},
		[],
	)

	return (
		<TranslationContext.Provider
			value={{
				t: translate,
				i18n: i18next,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

export default TranslationProvider
