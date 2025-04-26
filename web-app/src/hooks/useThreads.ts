import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

/**
 * Update this later
 */
export enum ContentType {
  Text = 'text',
  Image = 'image_url',
}

type ThreadState = {
  threads: Thread[]
  deletedThreadIds: string[]
  setThreads: (threads: Thread[]) => void
  fetchThreads: () => Promise<void>
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  deleteAllThreads: () => void
  unstarAllThreads: () => void
}

export const useThreads = create<ThreadState>()(
  persist(
    (set, get) => ({
      threads: [],
      deletedThreadIds: [],
      setThreads: (threads) => set({ threads }),
      toggleFavorite: (threadId) => {
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? { ...thread, isFavorite: !thread.isFavorite }
              : thread
          ),
        }))
      },
      deleteThread: (threadId) => {
        set((state) => ({
          threads: state.threads.filter((thread) => thread.id !== threadId),
          deletedThreadIds: [...state.deletedThreadIds, threadId],
        }))
      },
      deleteAllThreads: () => {
        set((state) => {
          const allThreadIds = state.threads.map((thread) => thread.id)
          return {
            threads: [],
            deletedThreadIds: [...state.deletedThreadIds, ...allThreadIds],
          }
        })
      },
      unstarAllThreads: () => {
        set((state) => ({
          threads: state.threads.map((thread) => ({
            ...thread,
            isFavorite: false,
          })),
        }))
      },
      getFavoriteThreads: () => {
        return get().threads.filter((thread) => thread.isFavorite)
      },
      getThreadById: (threadId: string) => {
        return get().threads.find((thread) => thread.id === threadId)
      },
      fetchThreads: async () => {
        const response = await new Promise<Thread[]>((resolve) =>
          setTimeout(
            () =>
              resolve([
                {
                  id: '1',
                  title: 'Ultimate Markdown Demonstration',
                  isFavorite: true,
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
              ]),
            0
          )
        )

        set((state) => {
          // Filter out deleted threads from the response
          const filteredResponse = response.filter(
            (thread) => !state.deletedThreadIds.includes(thread.id)
          )

          const localIds = state.threads.map((t) => t.id)
          const responseIds = filteredResponse.map((t) => t.id)

          const isSame =
            localIds.length === responseIds.length &&
            localIds.every((id) => responseIds.includes(id))

          if (isSame) {
            return {}
          }

          const existingIds = new Set(localIds)
          const newThreads = filteredResponse.filter(
            (t) => !existingIds.has(t.id)
          )

          return {
            threads: [...newThreads, ...state.threads],
          }
        })
      },
    }),
    {
      name: localStoregeKey.threads,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
