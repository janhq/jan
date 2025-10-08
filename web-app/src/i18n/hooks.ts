import { useContext } from "react"
import { TranslationContext } from "./context"

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)
