# Custom i18n Implementation

This is a custom internationalization (i18n) implementation that replaces the dependency on `react-i18next`. It provides the same functionality while being lightweight and tailored to our specific needs.

## Features

- ✅ Dynamic locale file loading using Vite's `import.meta.glob`
- ✅ Namespace support (e.g., `settings:general.appVersion`)
- ✅ Nested key support with dot notation (e.g., `common.placeholder.chatInput`)
- ✅ Variable interpolation (e.g., `{{variable}}`)
- ✅ Fallback language support
- ✅ React Context integration
- ✅ Compatibility layer for existing `useTranslation` code
- ✅ TypeScript support with proper types
- ✅ localStorage integration for language persistence

## File Structure

```
src/i18n/
├── setup.ts                 # Core i18n implementation and configuration
├── TranslationContext.tsx   # React Context provider and useAppTranslation hook
├── react-i18next-compat.ts  # Compatibility layer for existing code
├── index.ts                 # Main exports
├── example-usage.tsx        # Usage examples
└── README.md               # This documentation
```

## Usage

### 1. Using the new `useAppTranslation` hook (Recommended)

```tsx
import { useAppTranslation } from '@/i18n'

function MyComponent() {
  const { t } = useAppTranslation()

  return (
    <div>
      <h1>{t('common:settings')}</h1>
      <p>{t('settings:general.appVersion')}</p>
      <p>{t('common:placeholder.chatInput')}</p>
    </div>
  )
}
```

### 2. Using the compatibility layer (for existing code)

```tsx
import { useTranslation } from '@/i18n/react-i18next-compat'

function MyComponent() {
  const { t } = useTranslation()

  return (
    <div>
      <h1>{t('common:settings')}</h1>
      <p>{t('settings:general.appVersion')}</p>
    </div>
  )
}
```

### 3. Using with namespace parameter

```tsx
import { useTranslation } from '@/i18n/react-i18next-compat'

function MyComponent() {
  const { t } = useTranslation('settings')

  return (
    <div>
      <h1>{t('general.appVersion')}</h1>
      <p>{t('appearance.theme')}</p>
    </div>
  )
}
```

## Provider Setup

Wrap your app with the `TranslationProvider`:

```tsx
import { TranslationProvider } from '@/i18n'

function App() {
  return (
    <TranslationProvider>
      <YourAppContent />
    </TranslationProvider>
  )
}
```

## Translation Key Formats

### Namespace with colon notation

```tsx
t('settings:general.appVersion') // namespace: settings, key: general.appVersion
```

### Nested keys with dot notation

```tsx
t('common:placeholder.chatInput') // Accesses common.placeholder.chatInput
```

### Variable interpolation

```tsx
t('common:welcome', { name: 'John' }) // "Welcome {{name}}" becomes "Welcome John"
```

## Language Management

The implementation automatically:

- Loads the current language from localStorage (`settingGeneral.state.currentLanguage`)
- Falls back to English if the current language is not available
- Updates localStorage when language changes
- Integrates with the existing `useGeneralSetting` hook

## Migration from react-i18next

### Option 1: Gradual Migration (Recommended)

1. Keep existing `useTranslation` imports
2. Update imports to use the compatibility layer:

   ```tsx
   // Change from:
   import { useTranslation } from '@/i18n/react-i18next-compat'

   // To:
   import { useTranslation } from '@/i18n/react-i18next-compat'
   ```

### Option 2: Full Migration

1. Replace `useTranslation` with `useAppTranslation`:

   ```tsx
   // Change from:
   import { useTranslation } from '@/i18n/react-i18next-compat'
   const { t } = useTranslation()

   // To:
   import { useAppTranslation } from '@/i18n'
   const { t } = useAppTranslation()
   ```

## Locale File Structure

The implementation expects locale files in the following structure:

```
src/locales/
├── en/
│   ├── common.json
│   ├── settings.json
│   └── ...
├── id/
│   ├── common.json
│   ├── settings.json
│   └── ...
└── vn/
    ├── common.json
    ├── settings.json
    └── ...
```

## TypeScript Support

The implementation includes proper TypeScript types:

```tsx
import type { I18nInstance, TranslationResources } from '@/i18n'
```

## Performance

- Locale files are loaded eagerly using Vite's `import.meta.glob`
- Translation function is memoized to prevent unnecessary re-renders
- No external dependencies required
- Lightweight implementation (~130 lines of code)

## Compatibility

This implementation is designed to be a drop-in replacement for react-i18next in this project. It supports:

- All existing translation keys
- Variable interpolation
- Namespace notation
- Fallback languages
- React Context patterns

## Benefits over react-i18next

1. **No external dependencies** - Reduces bundle size
2. **Tailored to our needs** - Only includes features we actually use
3. **Better TypeScript integration** - Custom types for our specific use case
4. **Simpler debugging** - Full control over the implementation
5. **Performance optimized** - No unnecessary features or overhead
