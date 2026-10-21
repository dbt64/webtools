let generation = 0
/** Main-owned identity shared by Runtime 2.0 presentation/execution adapters. */
export function nextRuntimeGeneration(): number { return ++generation }
