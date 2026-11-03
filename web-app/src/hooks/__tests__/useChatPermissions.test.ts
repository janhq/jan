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

  it('changes one field at a time and adopts what the host saved', async () => {
    invoke.mockImplementation(async (_cmd: string, args: any) => args.value)
    await useChatPermissions.getState().set({ shellNetwork: false })
    expect(invoke).toHaveBeenCalledWith('set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: true },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
  })

  it('does not change the mirror when the host rejects the write', async () => {
    invoke.mockRejectedValue(new Error('disk full'))
    await expect(useChatPermissions.getState().set({ memoryWrite: false })).rejects.toThrow('disk full')
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: true })
  })

  it('serializes overlapping patches and merges against the latest host acknowledgement', async () => {
    const first = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    const second = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const saveNetwork = useChatPermissions.getState().set({ shellNetwork: false })
    const saveMemory = useChatPermissions.getState().set({ memoryWrite: false })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    expect(useChatPermissions.getState()).toMatchObject(DEFAULT_CHAT_PERMISSIONS)

    first.resolve({ shellNetwork: false, memoryWrite: true })
    await saveNetwork
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: true })
    second.resolve({ shellNetwork: false, memoryWrite: false })
    await saveMemory
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: false })
  })

  it('merges queued patches against the returned host value, not the requested value', async () => {
    const first = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockReturnValueOnce(first.promise).mockImplementationOnce(async (_cmd, args) => args.value)
    const saveNetwork = useChatPermissions.getState().set({ shellNetwork: false })
    const saveMemory = useChatPermissions.getState().set({ memoryWrite: false })
    first.resolve({ shellNetwork: true, memoryWrite: true })
    await Promise.all([saveNetwork, saveMemory])
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_chat_permissions', {
      value: { shellNetwork: true, memoryWrite: false },
    })
  })

  it('continues queued patches after a delayed rejected write without mirroring it', async () => {
    const first = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockReturnValueOnce(first.promise).mockImplementationOnce(async (_cmd, args) => args.value)
    const saveNetwork = useChatPermissions.getState().set({ shellNetwork: false })
    const rejected = expect(saveNetwork).rejects.toThrow('disk full')
    const saveMemory = useChatPermissions.getState().set({ memoryWrite: false })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    first.reject(new Error('disk full'))
    await rejected
    await saveMemory
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_chat_permissions', {
      value: { shellNetwork: true, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: true, memoryWrite: false })
  })

  it('does not let a delayed load overwrite a later settings write', async () => {
    const read = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockReturnValueOnce(read.promise).mockImplementationOnce(async (_cmd, args) => args.value)
    const load = useChatPermissions.getState().load()
    const save = useChatPermissions.getState().set({ memoryWrite: false })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    read.resolve({ shellNetwork: false, memoryWrite: true })
    await Promise.all([load, save])
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_chat_permissions', {
      value: { shellNetwork: false, memoryWrite: false },
    })
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: false })
  })

  it('queues a load behind an outstanding write so its acknowledgement stays ordered', async () => {
    const write = deferred<{ shellNetwork: boolean; memoryWrite: boolean }>()
    invoke.mockReturnValueOnce(write.promise).mockResolvedValueOnce({ shellNetwork: false, memoryWrite: false })
    const save = useChatPermissions.getState().set({ shellNetwork: false })
    const load = useChatPermissions.getState().load()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    write.resolve({ shellNetwork: false, memoryWrite: true })
    await Promise.all([save, load])
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_chat_permissions')
    expect(useChatPermissions.getState()).toMatchObject({ shellNetwork: false, memoryWrite: false })
  })

})
