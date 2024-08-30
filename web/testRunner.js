const jestRunner = require('jest-runner')

class EmptyTestFileRunner extends jestRunner.default {
  async runTests(tests, watcher, onStart, onResult, onFailure, options) {
    const nonEmptyTests = tests.filter(
      (test) => test.context.hasteFS.getSize(test.path) > 0
    )
    return super.runTests(
      nonEmptyTests,
      watcher,
      onStart,
      onResult,
      onFailure,
      options
    )
  }
}

module.exports = EmptyTestFileRunner
