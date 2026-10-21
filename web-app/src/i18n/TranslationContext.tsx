import React, { ReactNode, useEffect, useCallback, useState } from "react"
import i18next, { loadTranslations } from "./setup"
import { useGeneralSetting } from "@/hooks/useGeneralSetting"
import { TranslationContext } from "./context"
import { DirectionProvider } from "@radix-ui/react-direction"

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Get the current language from general settings
	const { currentLanguage } = useGeneralSetting()
	const [appliedLanguage, setAppliedLanguage] = useState(i18next.language)

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
			// Refresh consumers after asynchronous settings hydration changes the locale.
			setAppliedLanguage(i18next.language)
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
			<DirectionProvider dir={["ar", "ur", "arz", "pnb", "fa", "fa-IR"].includes(appliedLanguage) ? "rtl" : "ltr"}>
				{children}
			</DirectionProvider>
		</TranslationContext.Provider>
	)
}

export default TranslationProvider
