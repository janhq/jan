// Utility function to parse file_size string (e.g., "4.7 GB") to bytes
export const parseSizeToBytes = (sizeStr: string): number => {
    if (!sizeStr) return 0

    const units: Record<string, number> = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 * 1024,
        'GB': 1024 * 1024 * 1024,
        'TB': 1024 * 1024 * 1024 * 1024,
    }

    const match = sizeStr.trim().match(/^([\d.]+)\s*([A-Z]+)$/i)
    if (!match) return 0

    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()

    return value * (units[unit] || 0)
}

// Function to calculate estimated download time
export const calculateDownloadTime = (sizeInBytes: number): string => {
    if (sizeInBytes === 0) return 'N/A'

    const averageSpeedMbps = 100
    const speedBytesPerSecond = (averageSpeedMbps * 1000000) / 8
    const timeInSeconds = sizeInBytes / speedBytesPerSecond

    if (timeInSeconds < 60) {
        return `~${Math.ceil(timeInSeconds)}s`
    } else if (timeInSeconds < 3600) {
        const minutes = Math.ceil(timeInSeconds / 60)
        return `~${minutes}m`
    } else {
        const hours = Math.floor(timeInSeconds / 3600)
        const minutes = Math.ceil((timeInSeconds % 3600) / 60)
        if (minutes === 0) {
            return `~${hours}h`
        }
        return `~${hours}h ${minutes}m`
    }
}

// Function to calculate download speed
export const calculateDownloadSpeed = (): string => {
    const averageSpeedMbps = 100
    const speedBytesPerSecond = (averageSpeedMbps * 1000000) / 8
    const speedMBps = speedBytesPerSecond / (1024 * 1024)
    return `${speedMBps.toFixed(1)} MB/s`
}