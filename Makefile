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
	yarn config set network-timeout 300000
endif
	yarn build:core
	yarn install
	yarn build:extensions

#
check-file-counts: install-and-build
ifeq ($(OS),Windows_NT)
	powershell -Command "$$tgz_count = (Get-ChildItem -Path electron/pre-install -Filter *.tgz | Measure-Object | Select-Object -ExpandProperty Count); $$dir_count = (Get-ChildItem -Path extensions -Directory | Measure-Object | Select-Object -ExpandProperty Count); if ($$tgz_count -ne $$dir_count) { Write-Host 'Number of .tgz files in electron/pre-install (' + $$tgz_count + ') does not match the number of subdirectories in extension (' + $$dir_count + ')'; exit 1 } else { Write-Host 'Extension build successful' }"
else
	@tgz_count=$$(find electron/pre-install -name "*.tgz" | wc -l); \
	dir_count=$$(find extension -mindepth 1 -maxdepth 1 -type d | wc -l); \
	if [ $$tgz_count -ne $$dir_count ]; then \
		echo "Number of .tgz files in 'electron/pre-install' ($$tgz_count) does not match the number of subdirectories in 'extension' ($$dir_count)"; \
		exit 1; \
	else
		echo "Extension build successful";
	fi
endif

dev: check-file-counts
	yarn dev

# Linting
lint: check-file-counts
	yarn lint

# Testing
test: lint
	yarn build:test
	yarn test

# Builds and publishes the app
build-and-publish: check-file-counts
	yarn build:publish

# Build
build: check-file-counts
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
