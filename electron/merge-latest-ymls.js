const yaml = require('js-yaml')
const fs = require('fs')

// get two file paths from arguments:
const [, , ...args] = process.argv
const file1 = args[0]
const file2 = args[1]
const file3 = args[2]

// check that all arguments are present and throw error instead
if (!file1 || !file2 || !file3) {
  throw new Error(
    'Please provide 3 file paths as arguments: path to file1, to file2 and destination path'
  )
}

const doc1 = yaml.load(fs.readFileSync(file1, 'utf8'))
console.log('doc1: ', doc1)

const doc2 = yaml.load(fs.readFileSync(file2, 'utf8'))
console.log('doc2: ', doc2)

const merged = { ...doc1, ...doc2 }
merged.files.push(...doc1.files)

console.log('merged', merged)

const mergedYml = yaml.dump(merged)
fs.writeFileSync(file3, mergedYml, 'utf8')
