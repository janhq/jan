#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const blogDir = path.join(__dirname, '..', 'src', 'content', 'blog')

// Function to convert filename to a valid JavaScript variable name
function toVariableName(filename) {
  // Remove extension and special characters, convert to camelCase
  const base = path.basename(filename, path.extname(filename))
  let varName = base
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^./, (c) => c.toLowerCase())

  // If the variable name starts with a number, prefix with 'img'
  if (/^[0-9]/.test(varName)) {
    varName = 'img' + varName.charAt(0).toUpperCase() + varName.slice(1)
  }

  return varName
}

// Function to process a single MDX file
function processMDXFile(filePath) {
  console.log(`Processing: ${filePath}`)

  let content = fs.readFileSync(filePath, 'utf-8')

  // Find all image references
  const imageRegex = /!\[([^\]]*)\]\((\.\/_assets\/[^)]+)\)/g
  const images = []
  let match

  while ((match = imageRegex.exec(content)) !== null) {
    const altText = match[1]
    const imagePath = match[2]
    const filename = path.basename(imagePath)
    const varName = toVariableName(filename) + 'Img'

    // Check if we already have this image
    if (!images.find((img) => img.varName === varName)) {
      images.push({
        varName,
        path: imagePath,
        altText,
        originalMatch: match[0],
      })
    }
  }

  if (images.length === 0) {
    console.log(`  No images found in ${path.basename(filePath)}`)
    return
  }

  console.log(`  Found ${images.length} images`)

  // Find where to insert imports (after existing imports or frontmatter)
  const frontmatterEnd = content.indexOf('---', content.indexOf('---') + 3) + 3
  let importInsertPosition = frontmatterEnd

  // Check if there are already imports
  const existingImportRegex = /^import\s+.*$/gm
  const imports = content.match(existingImportRegex)

  if (imports && imports.length > 0) {
    // Find the last import
    const lastImport = imports[imports.length - 1]
    importInsertPosition = content.indexOf(lastImport) + lastImport.length
  }

  // Generate import statements
  const importStatements = images
    .map((img) => `import ${img.varName} from '${img.path}';`)
    .join('\n')

  // Insert imports
  if (imports && imports.length > 0) {
    // Add to existing imports
    content =
      content.slice(0, importInsertPosition) +
      '\n' +
      importStatements +
      content.slice(importInsertPosition)
  } else {
    // Add new import section after frontmatter
    content =
      content.slice(0, frontmatterEnd) +
      '\n\n' +
      importStatements +
      '\n' +
      content.slice(frontmatterEnd)
  }

  // Replace all image references with JSX img tags
  images.forEach((img) => {
    // Create regex for this specific image
    const specificImageRegex = new RegExp(
      `!\\[([^\\]]*)\\]\\(${img.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`,
      'g'
    )

    content = content.replace(specificImageRegex, (match, altText) => {
      return `<img src={${img.varName}.src} alt="${altText || img.altText}" />`
    })
  })

  // Write the updated content back
  fs.writeFileSync(filePath, content)
  console.log(`  ✓ Updated ${path.basename(filePath)}`)
}

// Process all MDX files in the blog directory
function processAllBlogPosts() {
  const files = fs.readdirSync(blogDir)
  const mdxFiles = files.filter((file) => file.endsWith('.mdx'))

  console.log(`Found ${mdxFiles.length} MDX files in blog directory\n`)

  mdxFiles.forEach((file) => {
    const filePath = path.join(blogDir, file)
    try {
      processMDXFile(filePath)
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message)
    }
  })

  console.log('\n✨ All blog posts processed!')
}

// Run the script
processAllBlogPosts()
