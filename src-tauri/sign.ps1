param (
  [string]$Target
)

AzureSignTool.exe sign `
  -tr http://timestamp.digicert.com `
  -kvu $env:AZURE_KEY_VAULT_URI `
  -kvi $env:AZURE_CLIENT_ID `
  -kvt $env:AZURE_TENANT_ID `
  -kvs $env:AZURE_CLIENT_SECRET `
  -kvc $env:AZURE_CERT_NAME `
  -v $Target