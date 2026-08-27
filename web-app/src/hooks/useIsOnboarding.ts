import { useModelProvider } from '@/hooks/useModelProvider'
import { hasUsableProvider } from '@/lib/providerReadiness'

/**
 * Whether first-run setup is still showing. The setup screen is the single
 * onboarding surface, so every other first-run prompt stays out of the way until
 * this is false -- otherwise they stack on top of it, each asking for something
 * the wizard already covers.
 *
 * Derived from the same gate the index route picks the setup screen by, so the
 * two cannot disagree.
 */
export function useIsOnboarding(): boolean {
  const providers = useModelProvider((state) => state.providers)
  return !hasUsableProvider(providers)
}
