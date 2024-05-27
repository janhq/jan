const { exec } = require('child_process')

function execCommandWithRetry(command, retries = 3) {
  return new Promise((resolve, reject) => {
    const execute = (attempt) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error}`)
          if (attempt < retries) {
            console.log(`Retrying... Attempt ${attempt + 1}`)
            execute(attempt + 1)
          } else {
            return reject(error)
          }
        } else {
          console.log(`stdout: ${stdout}`)
          console.error(`stderr: ${stderr}`)
          resolve()
        }
      })
    }
    execute(0)
  })
}

function sign({
  path,
  name,
  certUrl,
  clientId,
  tenantId,
  clientSecret,
  certName,
  timestampServer,
  version,
}) {
  return new Promise((resolve, reject) => {
    const command = `azuresigntool.exe sign -kvu "${certUrl}" -kvi "${clientId}" -kvt "${tenantId}" -kvs "${clientSecret}" -kvc "${certName}" -tr "${timestampServer}" -v "${path}"`
    execCommandWithRetry(command)
      .then(resolve)
      .catch(reject)
  })
}

exports.default = async function (options) {
  const certUrl = process.env.AZURE_KEY_VAULT_URI
  const clientId = process.env.AZURE_CLIENT_ID
  const tenantId = process.env.AZURE_TENANT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  const certName = process.env.AZURE_CERT_NAME
  const timestampServer = 'http://timestamp.globalsign.com/tsa/r6advanced1'

  try {
    await sign({
      path: options.path,
      name: 'jan-win-x64',
      certUrl,
      clientId,
      tenantId,
      clientSecret,
      certName,
      timestampServer,
      version: options.version,
    })
  } catch (error) {
    console.error('Failed to sign after 3 attempts:', error)
    process.exit(1)
  }
}
