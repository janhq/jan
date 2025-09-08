#!/usr/bin/env node

/**
 * Conditional Cloud Spec Generator
 *
 * This script conditionally runs the cloud spec generation based on environment variables.
 * It's designed to be used in CI/CD pipelines to control when the spec should be updated.
 *
 * Environment variables:
 * - SKIP_CLOUD_SPEC_UPDATE: Skip cloud spec generation entirely
 * - FORCE_UPDATE: Force update even if skip is set
 * - CI: Detect if running in CI environment
 */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration
const CONFIG = {
  CLOUD_SPEC_PATH: path.join(__dirname, '../public/openapi/cloud-openapi.json'),
  GENERATOR_SCRIPT: path.join(__dirname, 'generate-cloud-spec.js'),
  FALLBACK_SPEC_PATH: path.join(__dirname, '../public/openapi/openapi.json'),
}

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.cyan}ℹ️ `,
    skip: `${colors.gray}⏭️ `,
    run: `${colors.green}▶️ `,
    warning: `${colors.yellow}⚠️ `,
  }[type] || ''
  console.log(`${prefix}${message}${colors.reset}`)
}

async function shouldRunGenerator() {
  // Check environment variables
  const skipUpdate = process.env.SKIP_CLOUD_SPEC_UPDATE === 'true'
  const forceUpdate = process.env.FORCE_UPDATE === 'true'
  const isCI = process.env.CI === 'true'
  const isPR = process.env.GITHUB_EVENT_NAME === 'pull_request'

  // Force update overrides all
  if (forceUpdate) {
    log('Force update requested', 'info')
    return true
  }

  // Skip if explicitly requested
  if (skipUpdate) {
    log('Cloud spec update skipped (SKIP_CLOUD_SPEC_UPDATE=true)', 'skip')
    return false
  }

  // Skip in PR builds to avoid unnecessary API calls
  if (isPR) {
    log('Cloud spec update skipped (Pull Request build)', 'skip')
    return false
  }

  // Check if cloud spec already exists
  const specExists = fs.existsSync(CONFIG.CLOUD_SPEC_PATH)

  // In CI, only update if spec doesn't exist or if scheduled/manual trigger
  if (isCI) {
    const isScheduled = process.env.GITHUB_EVENT_NAME === 'schedule'
    const isManualWithUpdate =
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      process.env.UPDATE_CLOUD_SPEC === 'true'

    if (isScheduled || isManualWithUpdate) {
      log('Cloud spec update triggered (scheduled/manual)', 'info')
      return true
    }

    if (!specExists) {
      log('Cloud spec missing, will attempt to generate', 'warning')
      return true
    }

    log('Cloud spec update skipped (CI build, spec exists)', 'skip')
    return false
  }

  // For local development, update if spec is missing or older than 24 hours
  if (!specExists) {
    log('Cloud spec missing, generating...', 'info')
    return true
  }

  // Check if spec is older than 24 hours
  const stats = fs.statSync(CONFIG.CLOUD_SPEC_PATH)
  const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60)

  if (ageInHours > 24) {
    log(`Cloud spec is ${Math.round(ageInHours)} hours old, updating...`, 'info')
    return true
  }

  log(`Cloud spec is recent (${Math.round(ageInHours)} hours old), skipping update`, 'skip')
  return false
}

async function runGenerator() {
  return new Promise((resolve, reject) => {
    log('Running cloud spec generator...', 'run')

    const child = spawn('bun', [CONFIG.GENERATOR_SCRIPT], {
      stdio: 'inherit',
      env: { ...process.env }
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Generator exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

async function ensureFallback() {
  // If cloud spec doesn't exist but fallback does, copy it
  if (!fs.existsSync(CONFIG.CLOUD_SPEC_PATH) && fs.existsSync(CONFIG.FALLBACK_SPEC_PATH)) {
    log('Using fallback spec as cloud spec', 'warning')
    fs.copyFileSync(CONFIG.FALLBACK_SPEC_PATH, CONFIG.CLOUD_SPEC_PATH)
    return true
  }
  return false
}

async function main() {
  try {
    // Determine if we should run the generator
    const shouldRun = await shouldRunGenerator()

    if (shouldRun) {
      try {
        await runGenerator()
        log('Cloud spec generation completed', 'info')
      } catch (error) {
        log(`Cloud spec generation failed: ${error.message}`, 'warning')

        // Try to use fallback
        if (ensureFallback()) {
          log('Fallback spec used successfully', 'info')
        } else {
          log('No fallback available, build may fail', 'warning')
          // Don't exit with error - let the build continue
        }
      }
    } else {
      // Ensure we have at least a fallback spec
      if (!fs.existsSync(CONFIG.CLOUD_SPEC_PATH)) {
        ensureFallback()
      }
    }

    // Always exit successfully to not break the build
    process.exit(0)
  } catch (error) {
    console.error('Unexpected error:', error)
    // Even on error, try to continue the build
    process.exit(0)
  }
}

// Run the script
main()
