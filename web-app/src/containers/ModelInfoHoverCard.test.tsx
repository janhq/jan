import { describe, it, expect } from 'vitest'
import { parseSizeToBytes, calculateDownloadTime, calculateDownloadSpeed } from './ModelInfoHoverCard'

describe('parseSizeToBytes', () => {
    it('should parse bytes correctly', () => {
        expect(parseSizeToBytes('100 B')).toBe(100)
    })

    it('should parse KB correctly', () => {
        expect(parseSizeToBytes('1 KB')).toBe(1024)
        expect(parseSizeToBytes('2 KB')).toBe(2048)
    })

    it('should parse MB correctly', () => {
        expect(parseSizeToBytes('1 MB')).toBe(1048576)
        expect(parseSizeToBytes('5 MB')).toBe(5242880)
    })

    it('should parse GB correctly', () => {
        expect(parseSizeToBytes('1 GB')).toBe(1073741824)
        expect(parseSizeToBytes('4.7 GB')).toBeCloseTo(5046586572.8, 0)
    })

    it('should parse TB correctly', () => {
        expect(parseSizeToBytes('1 TB')).toBe(1099511627776)
    })

    it('should handle spacing variations', () => {
        expect(parseSizeToBytes('4.7GB')).toBeCloseTo(5046586572.8, 0)
        expect(parseSizeToBytes('4.7 GB')).toBeCloseTo(5046586572.8, 0)
        expect(parseSizeToBytes('  4.7  GB  ')).toBeCloseTo(5046586572.8, 0)
    })

    it('should return 0 for invalid input', () => {
        expect(parseSizeToBytes('')).toBe(0)
        expect(parseSizeToBytes('invalid')).toBe(0)
        expect(parseSizeToBytes('GB 4.7')).toBe(0)
    })

    it('should handle decimal values', () => {
        expect(parseSizeToBytes('1.5 GB')).toBeCloseTo(1610612736, 0)
        expect(parseSizeToBytes('0.5 GB')).toBe(536870912)
    })
})

describe('calculateDownloadTime', () => {
    it('should return N/A for 0 bytes', () => {
        expect(calculateDownloadTime(0)).toBe('N/A')
    })

    it('should format seconds correctly for small files', () => {
        // 10 MB file should take less than a minute (about 8 seconds)
        const tenMB = 10 * 1024 * 1024
        const result = calculateDownloadTime(tenMB)
        expect(result).toMatch(/~\d+s/)
    })

    it('should format minutes correctly for larger files', () => {
        // 2 GB file should take several minutes (about 2-3 minutes)
        const twoGB = 2 * 1024 * 1024 * 1024
        const result = calculateDownloadTime(twoGB)
        expect(result).toMatch(/~\d+m/)
    })

    it('should format hours correctly for very large files', () => {
        // 100 GB file should take hours
        const hundredGB = 100 * 1024 * 1024 * 1024
        const result = calculateDownloadTime(hundredGB)
        expect(result).toMatch(/~\d+h/)
    })

    it('should calculate specific time correctly', () => {
        // 1.25 GB at 100 Mbps should be ~2 minutes
        const oneTwoFiveGB = 1.25 * 1024 * 1024 * 1024
        const result = calculateDownloadTime(oneTwoFiveGB)
        expect(result).toBe('~2m')
    })

    it('should not return N/A for non-zero bytes', () => {
        expect(calculateDownloadTime(1000)).not.toBe('N/A')
    })

    it('should handle very small files in seconds', () => {
        const oneKB = 1024
        const result = calculateDownloadTime(oneKB)
        expect(result).toMatch(/~1s/)
    })
})

describe('calculateDownloadSpeed', () => {
    it('should return correctly formatted speed', () => {
        const result = calculateDownloadSpeed()
        expect(result).toMatch(/^\d+\.\d+ MB\/s$/)
    })

    it('should calculate speed in reasonable range for 100 Mbps', () => {
        const result = calculateDownloadSpeed()
        const speed = parseFloat(result)
        expect(speed).toBeGreaterThan(10)  // At least 10 MB/s
        expect(speed).toBeLessThan(15)     // Less than 15 MB/s
    })
})