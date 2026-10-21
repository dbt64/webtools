import { parseFeatureProjectionV2, type FeatureProjectionV2 } from '../../src/shared/feature-contracts.ts'

/**
 * Transport-independent full-snapshot queue for Projection v2.
 * Callers may connect enqueue only after the remote endpoint negotiates v2.
 */
export class NativeFeatureProjectionPublisher {
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private readonly project: () => Promise<FeatureProjectionV2> | FeatureProjectionV2
  private readonly enqueue: (projection: FeatureProjectionV2, serialized: string) => Promise<unknown>

  constructor(
    project: () => Promise<FeatureProjectionV2> | FeatureProjectionV2,
    enqueue: (projection: FeatureProjectionV2, serialized: string) => Promise<unknown>,
  ) {
    this.project = project
    this.enqueue = enqueue
  }

  sync(): Promise<void> {
    const next = this.tail.then(async () => {
      if (this.closed) return
      const projection = parseFeatureProjectionV2(await this.project())
      if (!projection) throw new Error('Invalid Feature Projection v2 snapshot.')
      if (this.closed) return
      const acknowledgement = await this.enqueue(projection, JSON.stringify(projection))
      if (!isMatchingAcknowledgement(acknowledgement, projection)) {
        throw new Error('Native Host acknowledged a different Feature Projection v2 session or revision.')
      }
    })
    this.tail = next.catch(() => {}) // An explicit later sync can recover after an unavailable queue/transport.
    return next
  }

  close(): void { this.closed = true }

  async trySync(reportFailure: () => void): Promise<boolean> {
    try { await this.sync(); return true }
    catch { reportFailure(); return false }
  }
}

function isMatchingAcknowledgement(value: unknown, projection: FeatureProjectionV2): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'hostSessionId' in value
    && value.hostSessionId === projection.hostSessionId
    && 'revision' in value
    && value.revision === projection.revision
}
