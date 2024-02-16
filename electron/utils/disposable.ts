export function dispose(requiredModules: Record<string, any>) {
  for (const key in requiredModules) {
    const module = requiredModules[key]
    if (typeof module['dispose'] === 'function') {
      module['dispose']()
    }
  }
}
