enum ContentType {
  Text = 'text',
  Image = 'image_url',
}

export const mockModelProvider = [
  {
    openai: {
      name: '@janhq/inference-openai-extension',
      productName: 'OpenAI Inference Engine',
      active: null,
      description: 'This extension enables OpenAI chat completion API calls',
      version: '1.0.5',
      apiKey: '',
      inferenceUrl: 'https://api.openai.com/v1/chat/completions',
      provider: 'openai',
      models: [
        {
          'gpt-4o': {
            setting: {
              contextLength: 128000,
              temperature: 0.7,
              topP: 1.0,
            },
            copabilities: ['vision', 'tools'],
          },
        },
        {
          'gpt-4-turbo': {
            setting: {
              contextLength: 128000,
              temperature: 0.7,
              topP: 1.0,
            },
          },
        },
        {
          'gpt-4': {
            setting: {
              contextLength: 8192,
              temperature: 0.7,
              topP: 1.0,
            },
          },
        },
        {
          'gpt-3.5-turbo': {
            setting: {
              contextLength: 16385,
              temperature: 0.7,
              topP: 1.0,
            },
          },
        },
        {
          'o1-mini': {
            setting: {
              contextLength: 128000,
              temperature: 0.7,
              topP: 1.0,
            },
          },
        },
        {
          'o1-preview': {
            setting: {
              contextLength: 128000,
              temperature: 0.7,
              topP: 1.0,
            },
          },
        },
      ],
    },
  },
  {
    anthropic: {
      name: '@janhq/inference-anthropic-extension',
      productName: 'Anthropic Inference Engine',
      active: null,
      description: 'This extension enables Anthropic chat completion API calls',
      version: '1.0.0',

      apiKey: '',
      inferenceUrl: 'https://api.anthropic.com/v1/messages',
      provider: 'anthropic',
      models: [
        {
          'claude-3-opus': {
            setting: {
              contextLength: 200000,
              temperature: 0.7,
              topP: 0.9,
            },
          },
        },
        {
          'claude-3-sonnet': {
            setting: {
              contextLength: 200000,
              temperature: 0.7,
              topP: 0.9,
            },
          },
        },
        {
          'claude-3-haiku': {
            setting: {
              contextLength: 200000,
              temperature: 0.7,
              topP: 0.9,
            },
          },
        },
        {
          'claude-2.1': {
            setting: {
              contextLength: 100000,
              temperature: 0.7,
              topP: 0.9,
            },
          },
        },
      ],
    },
  },
  {
    google: {
      name: '@janhq/inference-google-extension',
      productName: 'Google Gemini Inference Engine',
      active: null,
      description: 'This extension enables Google Gemini API calls',
      version: '1.0.0',

      apiKey: '',
      inferenceUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
      provider: 'google',
      models: [
        {
          'gemini-1.5-pro': {
            setting: {
              contextLength: 1000000,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'gemini-1.5-flash': {
            setting: {
              contextLength: 1000000,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'gemini-1.0-pro': {
            setting: {
              contextLength: 32768,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
      ],
    },
  },
  {
    meta: {
      name: '@janhq/inference-meta-extension',
      productName: 'Meta Llama Inference Engine',
      active: null,
      description: 'This extension enables Meta Llama API calls',
      version: '1.0.0',
      apiKey: '',
      inferenceUrl: 'https://api.meta.ai/v1/chat/completions',
      provider: 'meta',
      models: [
        {
          'llama-3-70b': {
            setting: {
              contextLength: 8192,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'llama-3-8b': {
            setting: {
              contextLength: 8192,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'llama-2-70b': {
            setting: {
              contextLength: 4096,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'llama-2-13b': {
            setting: {
              contextLength: 4096,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'llama-2-7b': {
            setting: {
              contextLength: 4096,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
      ],
    },
  },
  {
    mistral: {
      name: '@janhq/inference-mistral-extension',
      productName: 'Mistral AI Inference Engine',
      active: null,
      description: 'This extension enables Mistral AI API calls',
      version: '1.0.0',

      apiKey: '',
      inferenceUrl: 'https://api.mistral.ai/v1/chat/completions',
      provider: 'mistral',
      models: [
        {
          'mistral-large': {
            setting: {
              contextLength: 32768,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'mistral-medium': {
            setting: {
              contextLength: 32768,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'mistral-small': {
            setting: {
              contextLength: 32768,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
        {
          'open-mistral-7b': {
            setting: {
              contextLength: 8192,
              temperature: 0.7,
              topP: 0.95,
            },
          },
        },
      ],
    },
  },
  {
    llamacpp: {
      name: '@janhq/inference-llamacpp-extension',
      productName: 'Llama.cpp Local Inference Engine',
      active: null,
      description: 'This extension enables local inference using llama.cpp',
      version: '1.0.0',

      apiKey: '',
      inferenceUrl: 'http://localhost:8080/v1/chat/completions',
      provider: 'llamacpp',
      models: [
        {
          'local-model-1': {
            setting: {
              contextLength: 4096,
              temperature: 0.7,
              topP: 0.95,
              threads: 4,
              batchSize: 512,
            },
          },
        },
        {
          'local-model-2': {
            setting: {
              contextLength: 8192,
              temperature: 0.7,
              topP: 0.95,
              threads: 8,
              batchSize: 1024,
            },
          },
        },
      ],
    },
  },
]

export const mockTheads = [
  {
    id: '1',
    title: 'Ultimate Markdown Demonstration',
    isFavorite: false,
    content: [
      {
        type: ContentType.Text,
        text: {
          value: 'Dow u know Ultimate Markdown Demonstration',
          annotations: [],
        },
      },
      {
        type: ContentType.Text,
        text: {
          value:
            '# :books: Ultimate Markdown Demonstration\n\nWelcome to the **Ultimate Markdown Demo**! This document covers a wide range of Markdown features.\n\n---\n\n## 1. Headings\n\n# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n---\n\n## 2. Text Formatting\n\n- **Bold**\n- *Italic*\n- ***Bold & Italic***\n- ~~Strikethrough~~\n\n> "Markdown is _awesome_!" — *Someone Famous*\n\n---\n\n## 3. Lists\n\n### 3.1. Unordered List\n\n- Item One\n  - Subitem A\n  - Subitem B\n    - Sub-Subitem i\n\n### 3.2. Ordered List\n\n1. First\n2. Second\n    1. Second-First\n    2. Second-Second\n3. Third\n\n---\n\n## 4. Links and Images\n\n- [Visit OpenAI](https://openai.com)\n- Inline Image:\n\n  ![Markdown Logo](https://markdown-here.com/img/icon256.png)\n\n- Linked Image:\n\n  [![Markdown Badge](https://img.shields.io/badge/Markdown-Ready-blue)](https://commonmark.org)\n\n---\n\n## 5. Code\n\n### 5.1. Inline Code\n\nUse the `print()` function in Python.\n\n### 5.2. Code Block\n\n```python\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Markdown"))\n```\n\n### 5.3. Syntax Highlighting (JavaScript)\n\n```javascript\nconst add = (a, b) => a + b;\nconsole.log(add(5, 3));\n```\n\n---\n\n## 6. Tables\n\n| Syntax | Description | Example |\n|--------|-------------|--------|\n| Header | Title       | Here\'s this |\n| Paragraph | Text | And more text |\n\n---\n\n## 7. Blockquotes\n\n> "A blockquote can be used to highlight information or quotes."\n\nNested Blockquote:\n\nLevel 1\n>Level 2\nLevel 3\n\n---\n\n## 8. Task Lists\n\n- [x] Write Markdown\n- [x] Check the output\n- [ ] Celebrate\n\n---\n\n## 9. Footnotes\n\nHere is a simple footnote[^1].\n\n[^1]: This is the footnote explanation.\n\n---\n\n## 10. Horizontal Rules\n\n---\n\n## 11. Emojis\n\n:tada: :sunglasses: :thumbsup: :potable_water: :book:\n\n---\n\n## 12. Math (Using LaTeX)\n\nInline math: \\( E = mc^2 \\)\n\nBlock math:\n\n$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n---\n\n## 13. HTML in Markdown\n\nSometimes you need raw HTML:\n\n<div style="color:blue; font-weight:bold;">This is blue bold text using HTML inside Markdown!</div>\n\n---\n\n# :dart: That\'s a Wrap!\n\nCongratulations, you\'ve seen nearly every feature Markdown supports!',
          annotations: [],
        },
      },
    ],
  },
  {
    id: '2',
    title: 'Modern JavaScript: A Comprehensive Guide',
    isFavorite: false,
    content: [
      {
        type: ContentType.Text,
        text: {
          value:
            "# 🚀 Modern JavaScript: A Comprehensive Guide\n\nThis guide covers essential concepts and features of modern JavaScript that every developer should know.\n\n## ES6+ Features\n\n### Arrow Functions\n\nArrow functions provide a concise syntax for writing functions and lexically bind the `this` value.\n\n```javascript\n// Traditional function\nfunction add(a, b) {\n  return a + b;\n}\n\n// Arrow function\nconst add = (a, b) => a + b;\n\n// With implicit return\nconst numbers = [1, 2, 3, 4];\nconst doubled = numbers.map(n => n * 2); // [2, 4, 6, 8]\n```\n\n### Destructuring\n\nDestructuring allows you to extract values from arrays or properties from objects into distinct variables.\n\n```javascript\n// Array destructuring\nconst [first, second, ...rest] = [1, 2, 3, 4, 5];\nconsole.log(first); // 1\nconsole.log(second); // 2\nconsole.log(rest); // [3, 4, 5]\n\n// Object destructuring\nconst person = { name: 'John', age: 30, city: 'New York' };\nconst { name, age, city: location } = person;\nconsole.log(name); // 'John'\nconsole.log(age); // 30\nconsole.log(location); // 'New York'\n```\n\n### Spread and Rest Operators\n\nThe spread operator (`...`) allows an iterable to be expanded in places where zero or more arguments or elements are expected.\n\n```javascript\n// Spread with arrays\nconst arr1 = [1, 2, 3];\nconst arr2 = [...arr1, 4, 5]; // [1, 2, 3, 4, 5]\n\n// Spread with objects\nconst obj1 = { a: 1, b: 2 };\nconst obj2 = { ...obj1, c: 3 }; // { a: 1, b: 2, c: 3 }\n\n// Rest parameter\nfunction sum(...numbers) {\n  return numbers.reduce((total, num) => total + num, 0);\n}\nconsole.log(sum(1, 2, 3, 4)); // 10\n```\n\n## Asynchronous JavaScript\n\n### Promises\n\nPromises represent the eventual completion (or failure) of an asynchronous operation and its resulting value.\n\n```javascript\nconst fetchData = () => {\n  return new Promise((resolve, reject) => {\n    // Simulating an API call\n    setTimeout(() => {\n      const data = { id: 1, name: 'User' };\n      if (data) {\n        resolve(data);\n      } else {\n        reject('Error fetching data');\n      }\n    }, 1000);\n  });\n};\n\nfetchData()\n  .then(data => console.log(data))\n  .catch(error => console.error(error));\n```\n\n### Async/Await\n\nAsync/await is syntactic sugar built on top of promises, making asynchronous code look and behave more like synchronous code.\n\n```javascript\nconst fetchUser = async (id) => {\n  try {\n    const response = await fetch(`https://api.example.com/users/${id}`);\n    if (!response.ok) throw new Error('Network response was not ok');\n    const user = await response.json();\n    return user;\n  } catch (error) {\n    console.error('Error fetching user:', error);\n    throw error;\n  }\n};\n\n// Using the async function\n(async () => {\n  try {\n    const user = await fetchUser(1);\n    console.log(user);\n  } catch (error) {\n    console.error(error);\n  }\n})();\n```\n\n## Modern JavaScript Patterns\n\n### Module Pattern\n\nES modules provide a way to organize and structure code in separate files.\n\n```javascript\n// math.js\nexport const add = (a, b) => a + b;\nexport const subtract = (a, b) => a - b;\n\n// main.js\nimport { add, subtract } from './math.js';\nconsole.log(add(5, 3)); // 8\n```\n\n### Optional Chaining\n\nOptional chaining (`?.`) allows reading the value of a property located deep within a chain of connected objects without having to check if each reference in the chain is valid.\n\n```javascript\nconst user = {\n  name: 'John',\n  address: {\n    street: '123 Main St',\n    city: 'New York'\n  }\n};\n\n// Without optional chaining\nconst city = user && user.address && user.address.city;\n\n// With optional chaining\nconst city = user?.address?.city;\n```\n\n## Conclusion\n\nModern JavaScript has evolved significantly with ES6+ features, making code more concise, readable, and maintainable. Understanding these concepts is essential for any JavaScript developer working on modern web applications.",
          annotations: [],
        },
      },
    ],
  },
]
