import type { LauncherPluginProjection } from '../../src/shared/launcher-plugin-contracts.ts'

export class NativePluginProjectionPublisher {
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private readonly project: () => Promise<LauncherPluginProjection>
  private readonly send: (projection: LauncherPluginProjection) => Promise<unknown>
  constructor(project: () => Promise<LauncherPluginProjection>, send: (projection: LauncherPluginProjection) => Promise<unknown>) { this.project = project; this.send = send }
  sync(): Promise<void> {
    const next = this.tail.then(async () => {
      if (this.closed) return
      const projection = await this.project()
      if (!this.closed) await this.send(projection)
    })
    this.tail = next.catch(() => {}) // A later explicit refresh can recover after a transport failure.
    return next
  }
  close(): void { this.closed = true }
  async trySync(reportFailure: () => void): Promise<boolean> {
    try { await this.sync(); return true }
    catch { reportFailure(); return false }
  }
}
