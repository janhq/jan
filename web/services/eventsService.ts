/* eslint-disable @typescript-eslint/ban-types */
export class EventEmitter {
  private handlers: Map<string, Function[]>

  constructor() {
    this.handlers = new Map<string, Function[]>()
  }

  public on(eventName: string, handler: Function): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, [])
    }

    this.handlers.get(eventName)?.push(handler)
  }

  public off(eventName: string, handler: Function): void {
    if (!this.handlers.has(eventName)) {
      return
    }

    const handlers = this.handlers.get(eventName)
    const index = handlers?.indexOf(handler)

    if (index !== undefined && index !== -1) {
      handlers?.splice(index, 1)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(eventName: string, args: any): void {
    if (!this.handlers.has(eventName)) {
      return
    }

    const handlers = this.handlers.get(eventName)

    handlers?.forEach((handler) => {
      handler(args)
    })
  }
}
