const { https } = require('follow-redirects')
const fs = require('fs')
const path = require('path')
import common from '@data/common.json'
const compareData = common.compare
const confidenceData = common.confidence
export default class Utilities {
  fromRoot(relativePath: string): string {
    return path.resolve(process.cwd(), relativePath)
  }

  downloadFile(url: string, outputPath: string): Promise<void> {
    if (!fs.existsSync(this.fromRoot(outputPath))) {
      fs.mkdirSync(this.fromRoot(outputPath), { recursive: true })
    }
    const filename = this.fromRoot(
      outputPath + path.basename(url.split('?')[0])
    )
    return new Promise((resolve, reject) => {
      if (fs.existsSync(filename)) {
        console.log('⚠️ File already exists. Skipping download:', filename)
        resolve()
        return
      }
      const file = fs.createWriteStream(filename)
      https
        .get(url, (response: any) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(`Download failed. Status code: ${response.statusCode}`)
            )
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close(() => {
              console.log('✅ Download completed:', filename)
              resolve()
            })
          })
        })
        .on('error', (err: any) => {
          fs.unlink(outputPath, () => {})
          reject(err)
        })
    })
  }

  async measureResponseTime(actionDescription: any, actionFunction: any) {
    const start = Date.now()
    await actionFunction()
    const end = Date.now()
    const duration = end - start
    console.log(`⏱️ [${actionDescription}] took ${duration} ms`)
    return duration
  }

  countSentences(text: string) {
    return (text.match(/[.!?]/g) || []).length
  }

  averageWordLength(text: string) {
    const words = text.match(/\b\w+\b/g) || []
    if (words.length === 0) return 0
    const totalLength = words.reduce((sum, word) => sum + word.length, 0)
    return totalLength / words.length
  }

  textComplexityScore(text: string) {
    const numChars = text.length
    const words = text.trim().split(/\s+/)
    const numWords = words.length
    const numSentences = this.countSentences(text)
    const avgWordLen = this.averageWordLength(text)

    const score =
      0.4 * numWords +
      0.3 * avgWordLen +
      0.2 * numSentences +
      0.1 * (numChars / 100)

    return parseFloat(score.toFixed(2))
  }

  compareTextComplexityWithConfidence(text1: string, text2: string) {
    const score1 = this.textComplexityScore(text1)
    const score2 = this.textComplexityScore(text2)
    const diff = Math.abs(score1 - score2)
    const confidence = diff / Math.max(score1, score2)
    let compareText = ''
    if (score1 > score2) {
      compareText = compareData.text1Complex
    } else if (score2 > score1) {
      compareText = compareData.text2Complex
    } else {
      compareText = compareData.similar
    }
    let confidenceText = ''
    if (confidence > 0.3) {
      confidenceText = confidenceData.differenceClear
    } else if (confidence > 0.1) {
      confidenceText = confidenceData.differenceNotHugeOne
    } else {
      confidenceText = confidenceData.differenceVerySmall
    }
    return {
      complexityText1: score1,
      complexityText2: score2,
      confidenceLevel: (confidence * 100).toFixed(1) + '%',
      compare: compareText,
      confidence: confidenceText,
    }
  }
}
