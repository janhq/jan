NITRO_VERSION=$(cat ./bin/version.txt)
if [ ! -f "./bin/saved-${NITRO_VERSION}" ]; then
  rm -f ./bin/saved*
  touch ./bin/saved-${NITRO_VERSION}
  rm -rf ./bin/mac*
  rm -f ./bin/*.tar.gz
  curl -L https://github.com/janhq/nitro/releases/download/v${NITRO_VERSION}/nitro-${NITRO_VERSION}-mac-arm64.tar.gz -o ./bin/mac-arm64.tar.gz
  mkdir -p ./bin/mac-arm64
  tar -xzf ./bin/mac-arm64.tar.gz -C ./bin/mac-arm64 --strip-components=1
  chmod +x ./bin/mac-arm64/nitro
  curl -L https://github.com/janhq/nitro/releases/download/v${NITRO_VERSION}/nitro-${NITRO_VERSION}-mac-amd64.tar.gz -o ./bin/mac-amd64.tar.gz
  mkdir -p ./bin/mac-amd64
  tar -xzf ./bin/mac-amd64.tar.gz -C ./bin/mac-amd64 --strip-components=1
  chmod +x ./bin/mac-amd64/nitro
fi
