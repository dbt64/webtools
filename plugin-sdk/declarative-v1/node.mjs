import { isAbsolute, resolve } from 'node:path'

export function defineCommand(handler) {
  if (typeof handler !== 'function') throw new TypeError('A command handler must be a function.')
  return handler
}

export function getPluginPaths(preloadDirectory) {
  if (typeof preloadDirectory !== 'string' || !isAbsolute(preloadDirectory)) {
    throw new TypeError('Plugin preload directory must be an absolute path supplied by the runtime.')
  }
  const localDataDirectory = process.env.WEBTOOLS_PLUGIN_DATA
  if (!localDataDirectory || !isAbsolute(localDataDirectory)) {
    throw new Error('WebTools did not provide Plugin Local Data. Run the preload inside an active Node Plugin runtime.')
  }
  return Object.freeze({
    packageDirectory: resolve(preloadDirectory, '..'),
    localDataDirectory: resolve(localDataDirectory),
  })
}
