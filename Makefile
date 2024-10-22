# Makefile for Jan Electron App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Jan App"
REPORT_PORTAL_DESCRIPTION ?= "Jan App report"

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Builds the UI kit
build-joi:
ifeq ($(OS),Windows_NT)
	cd joi && yarn config set network-timeout 300000 && yarn install && yarn build
else
	cd joi && yarn install && yarn build
endif

# Installs yarn dependencies and builds core and extensions
install-and-build: build-joi
ifeq ($(OS),Windows_NT)
	yarn config set network-timeout 300000
endif
	yarn global add turbo@1.13.2
	yarn build:core
	yarn build:server
	yarn install
	yarn build:extensions

check-file-counts: install-and-build
ifeq ($(OS),Windows_NT)
	powershell -Command "if ((Get-ChildItem -Path pre-install -Filter *.tgz | Measure-Object | Select-Object -ExpandProperty Count) -ne (Get-ChildItem -Path extensions -Directory | Where-Object Name -like *-extension* | Measure-Object | Select-Object -ExpandProperty Count)) { Write-Host 'Number of .tgz files in pre-install does not match the number of subdirectories in extensions with package.json'; exit 1 } else { Write-Host 'Extension build successful' }"
else
	@tgz_count=$$(find pre-install -type f -name "*.tgz" | wc -l); dir_count=$$(find extensions -mindepth 1 -maxdepth 1 -type d -exec test -e '{}/package.json' \; -print | wc -l); if [ $$tgz_count -ne $$dir_count ]; then echo "Number of .tgz files in pre-install ($$tgz_count) does not match the number of subdirectories in extension ($$dir_count)"; exit 1; else echo "Extension build successful"; fi
	@chmod +x ./electron/scripts/post-uninstall.sh
endif

dev: check-file-counts
	yarn dev

# Linting
lint: check-file-counts
	yarn lint

update-playwright-config:
ifeq ($(OS),Windows_NT)
	echo -e "const RPconfig = {\n\
	    apiKey: '$(REPORT_PORTAL_API_KEY)',\n\
	    endpoint: '$(REPORT_PORTAL_URL)',\n\
	    project: '$(REPORT_PORTAL_PROJECT_NAME)',\n\
	    launch: '$(REPORT_PORTAL_LAUNCH_NAME)',\n\
	    attributes: [\n\
	        {\n\
	            key: 'key',\n\
	            value: 'value',\n\
	        },\n\
	        {\n\
	            value: 'value',\n\
	        },\n\
	    ],\n\
	    description: '$(REPORT_PORTAL_DESCRIPTION)',\n\
	}\n$$(cat electron/playwright.config.ts)" > electron/playwright.config.ts;
	sed -i "s/^  reporter: .*/    reporter: [['@reportportal\/agent-js-playwright', RPconfig]],/" electron/playwright.config.ts

else ifeq ($(shell uname -s),Linux)
	echo "const RPconfig = {\n\
	    apiKey: '$(REPORT_PORTAL_API_KEY)',\n\
	    endpoint: '$(REPORT_PORTAL_URL)',\n\
	    project: '$(REPORT_PORTAL_PROJECT_NAME)',\n\
	    launch: '$(REPORT_PORTAL_LAUNCH_NAME)',\n\
	    attributes: [\n\
	        {\n\
	            key: 'key',\n\
	            value: 'value',\n\
	        },\n\
	        {\n\
	            value: 'value',\n\
	        },\n\
	    ],\n\
	    description: '$(REPORT_PORTAL_DESCRIPTION)',\n\
	}\n$$(cat electron/playwright.config.ts)" > electron/playwright.config.ts;
	sed -i "s/^  reporter: .*/    reporter: [['@reportportal\/agent-js-playwright', RPconfig]],/" electron/playwright.config.ts
else
	echo "const RPconfig = {\n\
	    apiKey: '$(REPORT_PORTAL_API_KEY)',\n\
	    endpoint: '$(REPORT_PORTAL_URL)',\n\
	    project: '$(REPORT_PORTAL_PROJECT_NAME)',\n\
	    launch: '$(REPORT_PORTAL_LAUNCH_NAME)',\n\
	    attributes: [\n\
	        {\n\
	            key: 'key',\n\
	            value: 'value',\n\
	        },\n\
	        {\n\
	            value: 'value',\n\
	        },\n\
	    ],\n\
	    description: '$(REPORT_PORTAL_DESCRIPTION)',\n\
	}\n$$(cat electron/playwright.config.ts)" > electron/playwright.config.ts;
	sed -i '' "s|^  reporter: .*|    reporter: [['@reportportal\/agent-js-playwright', RPconfig]],|" electron/playwright.config.ts
endif

# Testing
test: lint
	yarn build:test
	yarn test:coverage
	yarn test

# Builds and publishes the app
build-and-publish: check-file-counts
	yarn build:publish

# Build
build: check-file-counts
	yarn build

clean:
ifeq ($(OS),Windows_NT)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include yarn.lock -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./electron/pre-install/*.tgz"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\jan\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\jan\extensions\" -Recurse -Force }"
else ifeq ($(shell uname -s),Linux)
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name "packake-lock.json" -type f -exec rm -rf '{}' +
	find . -name "yarn.lock" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	rm -rf "~/jan/extensions"
	rm -rf "~/.cache/jan*"
else
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name "packake-lock.json" -type f -exec rm -rf '{}' +
	find . -name "yarn.lock" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	rm -rf ~/jan/extensions
	rm -rf ~/Library/Caches/jan*
endif
