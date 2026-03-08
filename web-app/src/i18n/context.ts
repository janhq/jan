import { createContext } from "react"
import i18next from "./setup"

// Create context for translations
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, unknown>) => string
	i18n: typeof i18next
}>({
	t: (key: string) => key,
	i18n: i18next,
})
