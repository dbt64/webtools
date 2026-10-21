const { defineCommand } = require('@webtools/plugin-sdk/node')
module.exports = defineCommand(require('./actions.cjs').searchSelection)
