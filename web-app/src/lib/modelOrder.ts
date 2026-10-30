import { getModelDisplayName } from '@/lib/utils'

// Case-insensitive, with numbers compared by value so "gpt-4" sorts before
// "gpt-35-turbo" and "model-2" before "model-10".
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

/** Compare two models by the name the user sees, falling back to the id. */
export function compareModelsByName(a: Model, b: Model): number {
  return (
    collator.compare(getModelDisplayName(a), getModelDisplayName(b)) ||
    collator.compare(a.id, b.id)
  )
}

/**
 * A copy of `models` ordered by name. Providers store models in the order
 * their catalogs returned them (or the user added them), which reads as random
 * in a long list; the stored order itself is left alone.
 */
export function sortModelsByName<T extends Model>(models: readonly T[]): T[] {
  return [...models].sort(compareModelsByName)
}
