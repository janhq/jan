/**
 * The provider ids of the on-device inference engines Jan ships.
 *
 * Local engines differ from cloud providers in ways the UI cares about: they
 * read a per-model `ctx_len`, they are the only providers a local API server
 * may expose, and they keep the sampler controls enabled. Those checks used
 * to name `llamacpp` and `mlx` inline, which meant every new engine had to be
 * threaded through a dozen call sites by hand.
 *
 * `isLocalProvider` in `@/lib/utils` answers the same question at runtime
 * (does an engine with a `load` method exist for this id?). This module is
 * the static counterpart, for the pure functions and hooks that only have a
 * provider id in hand.
 */
export const LOCAL_ENGINE_IDS = new Set<string>([
  'llamacpp',
  'mlx',
  'litert-lm',
  'openvino',
])

/**
 * True when the provider id names a local inference engine.
 */
export function isLocalEngineId(
  provider: string | { provider?: string | null } | undefined | null
): boolean {
  if (!provider) return false
  const id = typeof provider === 'string' ? provider : provider.provider
  return !!id && LOCAL_ENGINE_IDS.has(id)
}

/**
 * The local CPU engines whose runtime Jan can install for the user.
 *
 * They run through a python runtime instead of a bundled binary, so the
 * provider page has to tell the user when it is missing and offer to put it
 * in place.
 */
export const MANAGED_CPU_ENGINES: Record<
  string,
  { name: string; package: string; modelKind: 'file' | 'folder' }
> = {
  'litert-lm': {
    name: 'LiteRT-LM',
    package: 'litert-lm',
    modelKind: 'file',
  },
  openvino: {
    name: 'OpenVINO',
    package: 'openvino + openvino-genai',
    modelKind: 'folder',
  },
}

/**
 * True when the provider id names a local CPU engine Jan manages the runtime
 * for.
 */
export function isManagedCpuEngine(
  provider: string | { provider?: string | null } | undefined | null
): boolean {
  if (!provider) return false
  const id = typeof provider === 'string' ? provider : provider.provider
  return !!id && id in MANAGED_CPU_ENGINES
}

/**
 * The engines the local API server can serve.
 *
 * The server proxy resolves a model to the engine session that holds it, and
 * it only has session maps for llama.cpp and MLX. The other local engines are
 * left out until the proxy learns about them, so the model list never offers
 * a model the server cannot answer for.
 */
export const LOCAL_API_SERVER_ENGINES = ['llamacpp', 'mlx']
