// Abstract Logger class that all loggers should extend.
export abstract class Logger {
  // Each logger must have a unique name.
  abstract name: string

  /**
   * Log message to log file.
   * This method should be overridden by subclasses to provide specific logging behavior.
   */
  abstract log(args: any): void
}

// LoggerManager is a singleton class that manages all registered loggers.
export class LoggerManager {
  // Map of registered loggers, keyed by their names.
  public loggers = new Map<string, Logger>()

  // Array to store logs that are queued before the loggers are registered.
  queuedLogs: any[] = []

  // Flag to indicate whether flushLogs is currently running.
  private isFlushing = false

  // Register a new logger. If a logger with the same name already exists, it will be replaced.
  register(logger: Logger) {
    this.loggers.set(logger.name, logger)
  }
  // Unregister a logger by its name.
  unregister(name: string) {
    this.loggers.delete(name)
  }

  get(name: string) {
    return this.loggers.get(name)
  }

  // Flush queued logs to all registered loggers.
  flushLogs() {
    // If flushLogs is already running, do nothing.
    if (this.isFlushing) {
      return
    }

    this.isFlushing = true

    while (this.queuedLogs.length > 0 && this.loggers.size > 0) {
      const log = this.queuedLogs.shift()
      this.loggers.forEach((logger) => {
        logger.log(log)
      })
    }

    this.isFlushing = false
  }

  // Log message using all registered loggers.
  log(args: any) {
    this.queuedLogs.push(args)

    this.flushLogs()
  }

  /**
   * The instance of the logger.
   * If an instance doesn't exist, it creates a new one.
   * This ensures that there is only one LoggerManager instance at any time.
   */
  static instance(): LoggerManager {
    let instance: LoggerManager | undefined = global.core?.logger
    if (!instance) {
      instance = new LoggerManager()
      if (!global.core) global.core = {}
      global.core.logger = instance
    }
    return instance
  }
}

export const log = (...args: any) => {
  LoggerManager.instance().log(args)
}
