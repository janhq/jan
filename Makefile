# Makefile for Jan Electron App - Build, Lint, Test, and Clean

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Builds the UI kit
build-uikit:
ifeq ($(OS),Windows_NT)
	cd uikit && yarn config set network-timeout 300000 && yarn install && yarn build
else
	cd uikit && yarn install && yarn build
endif

# Installs yarn dependencies and builds core and extensions
install-and-build: build-uikit
ifeq ($(OS),Windows_NT)
	powershell -Command "yarn config set network-timeout 300000; \
	$$env:NITRO_VERSION = Get-Content .\\plugins\\inference-plugin\\nitro\\version.txt; \
	Write-Output \"Nitro version: $$env:NITRO_VERSION\"; yarn build:core; yarn install; yarn build:plugins" 
else
	yarn config set network-timeout 300000
endif
	yarn build:core
	yarn install
	yarn build:extensions

dev: install-and-build
	yarn dev

# Linting
lint: install-and-build
	yarn lint

# Testing
test: lint
	yarn build:test
	yarn test

# Builds and publishes the app
build-and-publish: install-and-build
	yarn build:publish

# Build
build: install-and-build
	yarn build

clean:
ifeq ($(OS),Windows_NT)
	powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist -Recurse -Directory | Remove-Item -Recurse -Force"
	rmdir /s /q "%USERPROFILE%\AppData\Roaming\jan"
	rmdir /s /q "%USERPROFILE%\AppData\Roaming\jan-electron"
	rmdir /s /q "%USERPROFILE%\AppData\Local\jan*"
else ifeq ($(shell uname -s),Linux)
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	rm -rf "~/.config/jan"
	rm -rf "~/.config/jan-electron"
	rm -rf "~/.cache/jan*"
else
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	rm -rf ~/Library/Application\ Support/jan
	rm -rf ~/Library/Application\ Support/jan-electron
	rm -rf ~/Library/Caches/jan*
endif
