const { createCoverageMap } = require('istanbul-lib-coverage')
const { createReporter } = require('istanbul-api')
const fs = require('fs')
const path = require('path')

const coverageDir = path.join(__dirname, '../coverage')
const jestCoverage = path.join(coverageDir, 'jest/coverage-final.json')
const vitestCoverage = path.join(coverageDir, 'vitest/coverage-final.json')
const mergedDir = path.join(coverageDir, 'merged')

function normalizePath(filePath, workspace) {
  if (workspace === 'jest') {
    return `[CORE] ${filePath}`
  } else if (workspace === 'vitest') {
    return `[WEB-APP] ${filePath}`
  }
  return filePath
}

async function mergeCoverage() {
  const map = createCoverageMap({})

  console.log('🔍 Checking coverage files...')
  console.log('Jest coverage path:', jestCoverage)
  console.log('Vitest coverage path:', vitestCoverage)
  console.log('Jest file exists:', fs.existsSync(jestCoverage))
  console.log('Vitest file exists:', fs.existsSync(vitestCoverage))

  // Load Jest coverage (core workspace)
  if (fs.existsSync(jestCoverage)) {
    const jestData = JSON.parse(fs.readFileSync(jestCoverage, 'utf8'))
    console.log('Jest data keys:', Object.keys(jestData).length)
    map.merge(jestData)
    console.log('✓ Merged Jest coverage (core workspace)')
  } else {
    console.log('❌ Jest coverage file not found')
  }

  // Load Vitest coverage (web-app workspace)
  if (fs.existsSync(vitestCoverage)) {
    const vitestData = JSON.parse(fs.readFileSync(vitestCoverage, 'utf8'))
    console.log('Vitest data keys:', Object.keys(vitestData).length)
    map.merge(vitestData)
    console.log('✓ Merged Vitest coverage (web-app workspace)')
  } else {
    console.log('❌ Vitest coverage file not found')
  }

  console.log('📊 Total files in coverage map:', map.files().length)

  // Create merged directory
  if (!fs.existsSync(mergedDir)) {
    fs.mkdirSync(mergedDir, { recursive: true })
    console.log('✓ Created merged directory')
  }

  try {
    console.log('🔄 Generating reports...')

    const context = require('istanbul-lib-report').createContext({
      dir: mergedDir,
      coverageMap: map,
    })

    const htmlReporter = require('istanbul-reports').create('html')
    const lcovReporter = require('istanbul-reports').create('lcov')
    const textReporter = require('istanbul-reports').create('text')

    // Generate reports
    htmlReporter.execute(context)
    lcovReporter.execute(context)
    textReporter.execute(context)

    console.log('\n📊 Coverage reports merged successfully!')
    console.log('📁 HTML report: coverage/merged/index.html')
    console.log('📁 LCOV report: coverage/merged/lcov.info')

    // Check if files were created
    if (fs.existsSync(mergedDir)) {
      const mergedFiles = fs.readdirSync(mergedDir)
      console.log('📁 Files in merged directory:', mergedFiles)
    }
  } catch (error) {
    console.error('❌ Error generating reports:', error.message)
    console.error('Stack trace:', error.stack)
    throw error
  }

  // Generate separate reports for each workspace
  await generateWorkspaceReports()
}

async function generateWorkspaceReports() {
  // Generate separate core report
  if (fs.existsSync(jestCoverage)) {
    const coreMap = createCoverageMap({})
    const jestData = JSON.parse(fs.readFileSync(jestCoverage, 'utf8'))
    coreMap.merge(jestData)

    const coreDir = path.join(coverageDir, 'core-only')
    if (!fs.existsSync(coreDir)) {
      fs.mkdirSync(coreDir, { recursive: true })
    }

    const coreContext = require('istanbul-lib-report').createContext({
      dir: coreDir,
      coverageMap: coreMap,
    })

    const htmlReporter = require('istanbul-reports').create('html')
    const textSummaryReporter =
      require('istanbul-reports').create('text-summary')

    htmlReporter.execute(coreContext)
    textSummaryReporter.execute(coreContext)
    console.log('📁 Core-only report: coverage/core-only/index.html')
  }

  // Generate separate web-app report
  if (fs.existsSync(vitestCoverage)) {
    const webAppMap = createCoverageMap({})
    const vitestData = JSON.parse(fs.readFileSync(vitestCoverage, 'utf8'))
    webAppMap.merge(vitestData)

    const webAppDir = path.join(coverageDir, 'web-app-only')
    if (!fs.existsSync(webAppDir)) {
      fs.mkdirSync(webAppDir, { recursive: true })
    }

    const webAppContext = require('istanbul-lib-report').createContext({
      dir: webAppDir,
      coverageMap: webAppMap,
    })

    const htmlReporter = require('istanbul-reports').create('html')
    const textSummaryReporter =
      require('istanbul-reports').create('text-summary')

    htmlReporter.execute(webAppContext)
    textSummaryReporter.execute(webAppContext)
    console.log('📁 Web-app-only report: coverage/web-app-only/index.html')
  }
}

mergeCoverage().catch(console.error)
