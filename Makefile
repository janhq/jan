# Makefile for Jan Electron App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Jan App"
REPORT_PORTAL_DESCRIPTION ?= "Jan App report"

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Config yarn version

config-yarn:
	corepack enable
	corepack prepare yarn@4.5.3 --activate
	yarn --version
	yarn config set -H enableImmutableInstalls false

# Installs yarn dependencies and builds core and extensions
install-and-build: config-yarn
ifeq ($(OS),Windows_NT)
	echo "skip"
endif
	yarn install
	yarn build:core
	yarn build:extensions

dev: install-and-build
	yarn install:cortex
	yarn download:bin
	yarn copy:lib
	yarn dev

# Linting
lint: install-and-build
	yarn lint

# Testing
test: lint
	yarn test
	yarn test:e2e

# Builds and publishes the app
build-and-publish: install-and-build
	yarn build

# Build
build: install-and-build
	yarn build

# Deprecated soon
build-tauri: install-and-build
	yarn copy:lib
	yarn build

clean:
ifeq ($(OS),Windows_NT)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo, .yarn -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json, tsconfig.tsbuildinfo -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./electron/pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/resources"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/target"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\jan\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\jan\extensions\" -Recurse -Force }"
else ifeq ($(shell uname -s),Linux)
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name ".yarn" -type d -exec rm -rf '{}' +
	find . -name "packake-lock.json" -type f -exec rm -rf '{}' +
	find . -name "package-lock.json" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	rm -rf ./src-tauri/resources
	rm -rf ./src-tauri/target
	rm -rf "~/jan/extensions"
	rm -rf "~/.cache/jan*"
	rm -rf "./.cache"
else
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name ".yarn" -type d -exec rm -rf '{}' +
	find . -name "package-lock.json" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	rm -rf ./src-tauri/resources
	rm -rf ./src-tauri/target
	rm -rf ~/jan/extensions
	rm -rf ~/Library/Caches/jan*
endif
