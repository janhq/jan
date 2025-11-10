# Pull Request: Add Spanish (Español) Language Support 🌍

## 📋 Summary

This PR adds complete Spanish language support to Jan, making the application accessible to Spanish-speaking users worldwide.

## ✨ Changes

### Translation Files Added
- ✅ Created 15 complete Spanish translation files in `web-app/src/locales/es/`:
  - `common.json` (376 strings) - Common UI elements
  - `settings.json` (312 strings) - Settings interface
  - `chat.json` - Chat interface
  - `assistants.json` - Assistant management
  - `hub.json` - Model hub interface
  - `providers.json` - Provider configuration
  - `mcp-servers.json` - MCP servers
  - `system-monitor.json` - System monitoring
  - `tools.json` - Tools interface
  - `tool-approval.json` - Tool permissions
  - `logs.json` - Logs interface
  - `model-errors.json` - Error messages
  - `provider.json` - Provider settings
  - `setup.json` - Setup wizard
  - `updater.json` - Update notifications

### Code Changes
- ✅ Updated `LanguageSwitcher.tsx` to include Spanish ("Español") option
- ✅ Bumped version to 0.6.600 in `tauri.conf.json` and `package.json`
- ✅ Added release documentation and scripts

### Documentation
- ✅ Created comprehensive release notes (`RELEASE_NOTES_v0.6.600.md`)
- ✅ Added release instructions (`CREATE_RELEASE_INSTRUCTIONS.md`)
- ✅ Included automated release script (`create-release.sh`)

## 🎯 How to Test

1. Checkout this branch
2. Run the application
3. Go to Settings → General → Language
4. Select "Español" from the dropdown
5. Verify that all UI elements are translated correctly

## 📊 Statistics

- **Files Changed**: 19
- **Lines Added**: 1,291+
- **Translation Coverage**: 970+ strings
- **Languages Supported**: Now 10 (added Spanish)

## 🌐 Supported Languages After This PR

- 🇬🇧 English
- 🇪🇸 **Español (NEW!)**
- 🇮🇩 Bahasa Indonesia
- 🇵🇱 Polski
- 🇻🇳 Tiếng Việt
- 🇨🇳 简体中文
- 🇹🇼 繁體中文
- 🇩🇪 Deutsch
- 🇧🇷 Português (Brasil)
- 🇯🇵 日本語

## 📝 Commits

1. `feat: add Spanish (Español) language support`
   - Added all 15 Spanish translation files
   - Updated LanguageSwitcher component

2. `chore: bump version to 0.6.600 for Spanish language release`
   - Updated version in tauri.conf.json
   - Updated version in web-app/package.json

3. `docs: add release documentation and scripts for v0.6.600`
   - Added release notes
   - Added release creation instructions
   - Added automated release script

## ✅ Checklist

- [x] All translation files created and properly formatted
- [x] Spanish option added to language switcher
- [x] Version bumped appropriately
- [x] No breaking changes
- [x] Documentation updated
- [x] Release notes prepared
- [x] All commits follow conventional commits format

## 🔗 Related Issues

Closes #[issue-number] (if applicable)

## 📸 Screenshots

After merging, users will see "Español" in the language selector:

Settings → General → Language → **Español** ✨

## 🚀 Post-Merge Actions

After merging this PR:
1. Create release tag `v0.6.600`
2. GitHub Actions will automatically build installers for all platforms
3. Publish the release with Spanish language support

## 🙏 Acknowledgments

This translation makes Jan accessible to 500+ million Spanish speakers worldwide!

---

**Ready to merge!** 🎉
