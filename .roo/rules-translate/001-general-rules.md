# 1. SUPPORTED LANGUAGES AND LOCATION

- Localize all strings into the following locale files: en, vi, id
- WebView UI: web-app/src/locales/ (user interface)

# 2. VOICE, STYLE AND TONE

- Always use informal speech (e.g., "du" instead of "Sie" in German) for all translations
- Maintain a direct and concise style that mirrors the tone of the original text
- Carefully account for colloquialisms and idiomatic expressions in both source and target languages
- Aim for culturally relevant and meaningful translations rather than literal translations
- Preserve the personality and voice of the original content
- Use natural-sounding language that feels native to speakers of the target language
- Don't translate the word "token" as it means something specific in English that all languages will understand
- Don't translate domain-specific words (especially technical terms like "Prompt") that are commonly used in English in the target language

# 3. WEB-APP UI LOCALIZATION (web-app/src/)

- Located in web-app/src/locales/
- Uses standard React i18next patterns with the useTranslation hook
- All user interface strings should be internationalized
- Always use the Trans component with named components for text with embedded components

# 4. TECHNICAL IMPLEMENTATION

- Use namespaces to organize translations logically
- Handle pluralization using i18next's built-in capabilities
- Implement proper interpolation for variables using {{variable}} syntax
- Don't include defaultValue. The `en` translations are the fallback
- Always use apply_diff instead of write_to_file when editing existing translation files (much faster and more reliable)
- When using apply_diff, carefully identify the exact JSON structure to edit to avoid syntax errors
- Placeholders (like {{variable}}) must remain exactly identical to the English source to maintain code integration and prevent syntax errors

# 5. WORKFLOW AND APPROACH

- First add or modify English strings, then ask for confirmation before translating to all other languages
- Use this process for each localization task:
  1. Identify where the string appears in the UI/codebase
  2. Understand the context and purpose of the string
  3. Update English translation first
  4. Create appropriate translations for all other supported languages
  5. Validate your changes with the missing translations script
- Flag or comment if an English source string is incomplete ("please see this...") to avoid truncated or unclear translations
- For UI elements, distinguish between:
  - Button labels: Use short imperative commands ("Save", "Cancel")
  - Tooltip text: Can be slightly more descriptive
- Preserve the original perspective: If text is a user command directed at the software, ensure the translation maintains this direction, avoiding language that makes it sound like an instruction from the system to the user

# 6. COMMON PITFALLS TO AVOID

- Switching between formal and informal addressing styles - always stay informal ("du" not "Sie")
- Translating or altering technical terms and brand names that should remain in English
- Modifying or removing placeholders like {{variable}} - these must remain identical
- Translating domain-specific terms that are commonly used in English in the target language
- Changing the meaning or nuance of instructions or error messages
- Forgetting to maintain consistent terminology throughout the translation

# 7. QUALITY ASSURANCE

- Maintain consistent terminology across all translations
- Respect the JSON structure of translation files
- Watch for placeholders and preserve them in translations
- Be mindful of text length in UI elements when translating to languages that might require more characters
- Use context-aware translations when the same string has different meanings
- Always validate your translation work by running the missing translations script:
  ```
  node scripts/find-missing-translations.js
  ```
- Address any missing translations identified by the script to ensure complete coverage across all locales

# 8. TRANSLATOR'S CHECKLIST

- ✓ Used informal tone consistently ("du" not "Sie")
- ✓ Preserved all placeholders exactly as in the English source
- ✓ Maintained consistent terminology with existing translations
- ✓ Kept technical terms and brand names unchanged where appropriate
- ✓ Preserved the original perspective (user→system vs system→user)
- ✓ Adapted the text appropriately for UI context (buttons vs tooltips)
