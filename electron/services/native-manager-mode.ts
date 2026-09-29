export function isNativeManagerOnly(argv: readonly string[], environment: NodeJS.ProcessEnv): boolean {
  return argv.includes('--manager-only') || environment.WEBTOOLS_MANAGER_ONLY === '1'
}
