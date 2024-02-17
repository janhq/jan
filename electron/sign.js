const { exec } = require('child_process')

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

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error}`)
        return reject(error)
      }
      console.log(`stdout: ${stdout}`)
      console.error(`stderr: ${stderr}`)
      resolve()
    })
  })
}

exports.default = async function (options) {
  const certUrl = process.env.AZURE_KEY_VAULT_URI
  const clientId = process.env.AZURE_CLIENT_ID
  const tenantId = process.env.AZURE_TENANT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  const certName = process.env.AZURE_CERT_NAME
  const timestampServer = 'http://timestamp.globalsign.com/tsa/r6advanced1'

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
}
