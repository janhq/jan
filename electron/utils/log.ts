import { getJanDataFolderPath } from '@janhq/core/node'
import * as fs from 'fs'
import * as path from 'path'

export function cleanLogs(
  maxFileSizeBytes?: number | undefined,
  daysToKeep?: number | undefined,
  delayMs?: number | undefined
): void {
  const size = maxFileSizeBytes ?? 1 * 1024 * 1024 // 1 MB
  const days = daysToKeep ?? 7 // 7 days
  const delays = delayMs ?? 10000 // 10 seconds
  const logDirectory = path.join(getJanDataFolderPath(), 'logs')

  // Perform log cleaning
  const currentDate = new Date()
  fs.readdir(logDirectory, (err, files) => {
    if (err) {
      console.error('Error reading log directory:', err)
      return
    }

    files.forEach((file) => {
      const filePath = path.join(logDirectory, file)
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error('Error getting file stats:', err)
          return
        }

        // Check size
        if (stats.size > size) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error('Error deleting log file:', err)
              return
            }
            console.debug(
              `Deleted log file due to exceeding size limit: ${filePath}`
            )
          })
        } else {
          // Check age
          const creationDate = new Date(stats.ctime)
          const daysDifference = Math.floor(
            (currentDate.getTime() - creationDate.getTime()) /
              (1000 * 3600 * 24)
          )
          if (daysDifference > days) {
            fs.unlink(filePath, (err) => {
              if (err) {
                console.error('Error deleting log file:', err)
                return
              }
              console.debug(`Deleted old log file: ${filePath}`)
            })
          }
        }
      })
    })
  })

  // Schedule the next execution with doubled delays
  setTimeout(() => {
    cleanLogs(maxFileSizeBytes, daysToKeep, delays * 2)
  }, delays)
}
