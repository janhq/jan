const capitalize = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const camelCase = (str) => {
  return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
}

const categories = ['building-jan', 'research', 'guides']

/**
 * @param {import("plop").NodePlopAPI} plop
 */
module.exports = function main(plop) {
  plop.setHelper('capitalize', (text) => {
    return capitalize(camelCase(text))
  })

  plop.load('plop-helper-date')

  plop.setGenerator('create-blogpost', {
    description: 'Generates a blog post',
    prompts: [
      {
        type: 'list',
        name: 'categories',
        message: 'what is categories of blog post: ',
        choices: categories,
      },
      {
        type: 'input',
        name: 'slug',
        message: 'Enter slug of blog post: ',
      },
      {
        type: 'input',
        name: 'title',
        message: 'Enter title of blog post: ',
      },
      {
        type: 'input',
        name: 'description',
        message: 'The description of blog post: ',
      },
    ],

    actions(answers) {
      const actions = []
      if (!answers) return actions
      const { categories, slug, title, description } = answers

      actions.push({
        type: 'addMany',
        templateFiles: 'templates/**',
        destination: `./src/pages/post`,
        globOptions: { dot: true },
        data: { categories, slug, title, description },
        abortOnFail: true,
      })

      return actions
    },
  })
}
