// joinPath from @janhq/core forwards to the host API; join with '/' the way
// the virtual file:// paths in the tests are keyed.
Object.defineProperty(globalThis, 'core', {
  value: {
    api: { joinPath: async ({ args }: { args: string[] }) => args.join('/') },
  },
  writable: true,
})
