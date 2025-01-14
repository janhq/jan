import { BaseExtension, SettingItem } from '@janhq/core'

export default class UserPreferencesExtension extends BaseExtension {
  name = 'user-preferences'
  productName = 'User Preferences'

  async getSettings(): Promise<SettingItem[]> {
    const settings: SettingItem[] = [
      {
        key: 'username',
        title: 'Username',
        description: 'Your display name in the application',
        controllerType: 'input',
        controllerProps: {
          placeholder: 'Enter your username',
          value: await this.getSetting('username') || 'User',
          type: 'text',
          textAlign: 'left'
        }
      },
      {
        key: 'profileImage',
        title: 'Profile Picture',
        description: 'Your profile picture path',
        controllerType: 'input',
        controllerProps: {
          placeholder: 'Profile picture path',
          value: await this.getSetting('profileImage') || '',
          type: 'text',
          textAlign: 'left',
          inputActions: [
            {
              type: 'button',
              label: 'Choose File',
              onClick: async () => {
                try {
                  if (window.core?.api) {
                    // Get Jan data folder
                    const dataFolder = await window.core.api.getJanDataFolderPath()
                    if (!dataFolder) return

                    // Create images directory
                    const imagesDir = await window.core.api.joinPath([dataFolder, 'images'])
                    try {
                      await window.core.api.mkdir(imagesDir)
                    } catch (error) {
                      // Directory might already exist
                    }

                    // Open file dialog
                    const result = await window.core.api.showOpenDialog({
                      title: 'Select Profile Picture',
                      filters: [
                        { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }
                      ],
                      properties: ['openFile']
                    })

                    if (result.filePaths.length > 0) {
                      const sourcePath = result.filePaths[0]
                      const fileName = `profile-${Date.now()}.${sourcePath.split('.').pop()}`
                      const targetPath = await window.core.api.joinPath([imagesDir, fileName])

                      // Copy file to Jan data folder
                      await window.core.api.copyFile(sourcePath, targetPath)

                      // Update setting
                      await this.setSetting('profileImage', targetPath)
                    }
                  }
                } catch (error) {
                  console.error('Failed to update profile picture:', error)
                }
              }
            }
          ]
        }
      }
    ]

    return settings
  }

  async getSetting(key: string): Promise<string> {
    try {
      return await super.getSetting(key) || ''
    } catch (error) {
      console.error(`Failed to get setting ${key}:`, error)
      return ''
    }
  }

  async setSetting(key: string, value: string): Promise<void> {
    try {
      await super.setSetting(key, value)
    } catch (error) {
      console.error(`Failed to set setting ${key}:`, error)
      throw error
    }
  }
}
