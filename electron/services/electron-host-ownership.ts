export interface HostOwnershipSnapshot {
  revision: number
  sessionIds: string[]
  requests: { requestId: string; state: 'queued' | 'delivered' }[]
}

/** NativeHost owns the snapshot; Electron owns the execution of each request. */
export class ElectronHostOwnership {
  private revision = -1
  private synchronized = false
  private sessions = new Set<string>()
  private requests = new Set<string>()
  private executions = new Map<string, Promise<unknown>>()
  private executing = new Set<string>()

  get snapshotRevision(): number { return this.revision }
  get hasOwnership(): boolean {
    return !this.synchronized || this.sessions.size > 0 || this.requests.size > 0 || this.executing.size > 0
  }
  connected(): void { this.synchronized = true }
  disconnected(): void { this.synchronized = false }

  replace(value: unknown): void {
    const snapshot = value as HostOwnershipSnapshot
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || !Array.isArray(snapshot.sessionIds) || !snapshot.sessionIds.every(id => typeof id === 'string' && id.length > 0)
      || !Array.isArray(snapshot.requests) || !snapshot.requests.every(request => request && typeof request.requestId === 'string'
        && request.requestId.length > 0 && ['queued', 'delivered'].includes(request.state))) throw new TypeError('Invalid Host ownership snapshot.')
    if (snapshot.revision < this.revision) return
    this.revision = snapshot.revision
    this.sessions = new Set(snapshot.sessionIds)
    this.requests = new Set(snapshot.requests.map(request => request.requestId))
    for (const id of this.executions.keys()) if (!this.requests.has(id) && !this.executing.has(id)) this.executions.delete(id)
  }

  execute<T>(requestId: string, action: () => Promise<T>): Promise<T> {
    const existing = this.executions.get(requestId)
    if (existing) return existing as Promise<T>
    if (!this.requests.has(requestId)) return Promise.reject(new Error('NativeHost has not acquired this request.'))
    this.executing.add(requestId)
    const execution = (async () => {
      try { return await action() }
      finally {
        this.executing.delete(requestId)
        if (!this.requests.has(requestId)) this.executions.delete(requestId)
      }
    })()
    this.executions.set(requestId, execution)
    return execution
  }
}
