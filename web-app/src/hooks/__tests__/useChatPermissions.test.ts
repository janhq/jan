import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke }) }),
}))

import { DEFAULT_CHAT_PERMISSIONS, useChatPermissions } from '../useChatPermissions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useChatPermissions', () => {
  beforeEach(() => {
    invoke.mockReset()
    useChatPermissions.setState({ ...DEFAULT_CHAT_PERMISSIONS })
  })

  it('defaults to network and memory writes on, like the old Cowork behaviour', () => {
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: true })
  })

  it('mirrors the host value when it loads', async () => {
    invoke.mockResolvedValue({ shellNetwork: false, memoryWrite: true })
    await useChatPermissions.getState().load()
    expect(invoke).toHaveBeenCalledWith('get_chat_permissions')
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
  })

  it('keeps the current mirror when the host cannot be read', async () => {
    invoke.mockRejectedValue(new Error('ipc down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useChatPermissions.getState().load()
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: true })
    warn.mockRestore()
  })

  it('reads persisted permissions before saving after the startup load fails', async () => {
    const persisted = { shellNetwork: false, memoryWrite: false }
    invoke.mockRejectedValueOnce(new Error('startup ipc down'))
      .mockImplementation(async (cmd, args) => cmd === 'get_chat_permissions' ? persisted : args.value)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await useChatPermissions.getState().load()
      await useChatPermissions.getState().set({ shellNetwork: true })
      expect(invoke).toHaveBeenCalledWith('set_chat_permissions', {
        value: { shellNetwork: true, memoryWrite: false },
      })
      expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: false })
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects a save without setter IPC when its fresh host read fails', async () => {
    invoke.mockRejectedValue(new Error('ipc down'))
    await expect(useChatPermissions.getState().set({ memoryWrite: false })).rejects.toThrow('ipc down')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('get_chat_permissions')
    expect(useChatPermissions.getState()).toMatchObject(DEFAULT_CHAT_PERMISSIONS)
  })

  it('changes one field at a time and adopts what the host saved', async () => {
    invoke.mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockImplementationOnce(async (_cmd, args) => args.value)
    await useChatPermissions.getState().set({ shellNetwork: false })
    expect(invoke).toHaveBeenCalledWith('set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: true },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
  })

  it('mirrors the host acknowledgement rather than the fresh read or requested patch', async () => {
    invoke.mockResolvedValueOnce({ shellNetwork: false, memoryWrite: false })
      .mockResolvedValueOnce({ shellNetwork: false, memoryWrite: true })
    await useChatPermissions.getState().set({ shellNetwork: true })
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_chat_permissions', {
      value: { shellNetwork: true, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
  })

  it('continues queued saves after a fresh read fails, using the next successful read', async () => {
    invoke.mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce({ shellNetwork: false, memoryWrite: false })
      .mockImplementationOnce(async (_cmd, args) => args.value)
    const failed = expect(useChatPermissions.getState().set({ shellNetwork: true })).rejects.toThrow('ipc down')
    const saved = useChatPermissions.getState().set({ memoryWrite: true })
    await Promise.all([failed, saved])
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_chat_permissions')
    expect(invoke).toHaveBeenNthCalledWith(3, 'set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: true },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
  })

  it('does not change the mirror when the host rejects the write', async () => {
    invoke.mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockRejectedValueOnce(new Error('disk full'))
    await expect(useChatPermissions.getState().set({ memoryWrite: false })).rejects.toThrow('disk full')
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: true })
  })

  it('serializes overlapping patches and merges against the latest host acknowledgement', async () => {
    const first = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    const second = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ shellNetwork: false, memoryWrite: true })
      .mockReturnValueOnce(second.promise)

    const saveNetwork = useChatPermissions.getState().set({ shellNetwork: false })
    const saveMemory = useChatPermissions.getState().set({ memoryWrite: false })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(useChatPermissions.getState()).toMatchObject(DEFAULT_CHAT_PERMISSIONS)

    first.resolve({ shellNetwork: false, memoryWrite: true })
    await saveNetwork
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(4))
    expect(invoke).toHaveBeenNthCalledWith(4, 'set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
    second.resolve({ shellNetwork: false, memoryWrite: false })
    await saveMemory
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: false })
  })

  it('merges queued patches against the returned host value, not the requested value', async () => {
    const first = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockImplementationOnce(async (_cmd, args) => args.value)
    const saveNetwork = useChatPermissions.getState().set({ shellNetwork: false })
    const saveMemory = useChatPermissions.getState().set({ memoryWrite: false })
    first.resolve({ shellNetwork: true, memoryWrite: true })
    await Promise.all([saveNetwork, saveMemory])
    expect(invoke).toHaveBeenNthCalledWith(4, 'set_chat_permissions', {
      value: { shellNetwork: true, memoryWrite: false },
    })
  })

  it('continues queued patches after a delayed rejected write without mirroring it', async () => {
    const first = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockImplementationOnce(async (_cmd, args) => args.value)
    const saveNetwork = useChatPermissions.getState().set({ shellNetwork: false })
    const rejected = expect(saveNetwork).rejects.toThrow('disk full')
    const saveMemory = useChatPermissions.getState().set({ memoryWrite: false })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    first.reject(new Error('disk full'))
    await rejected
    await saveMemory
    expect(invoke).toHaveBeenNthCalledWith(4, 'set_chat_permissions', {
      value: { shellNetwork: true, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: false })
  })

  it('does not let a delayed load overwrite a later settings write', async () => {
    const read = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockReturnValueOnce(read.promise)
      .mockResolvedValueOnce({ shellNetwork: false, memoryWrite: true })
      .mockImplementationOnce(async (_cmd, args) => args.value)
    const load = useChatPermissions.getState().load()
    const save = useChatPermissions.getState().set({ memoryWrite: false })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    read.resolve({ shellNetwork: false, memoryWrite: true })
    await Promise.all([load, save])
    expect(invoke).toHaveBeenNthCalledWith(3, 'set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: false })
  })

  it('queues a load behind an outstanding write so its acknowledgement stays ordered', async () => {
    const write = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockResolvedValueOnce(DEFAULT_CHAT_PERMISSIONS)
      .mockReturnValueOnce(write.promise)
      .mockResolvedValueOnce({ shellNetwork: false, memoryWrite: false })
    const save = useChatPermissions.getState().set({ shellNetwork: false })
    const load = useChatPermissions.getState().load()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    write.resolve({ shellNetwork: false, memoryWrite: true })
    await Promise.all([save, load])
    expect(invoke).toHaveBeenNthCalledWith(3, 'get_chat_permissions')
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: false })
  })

})
