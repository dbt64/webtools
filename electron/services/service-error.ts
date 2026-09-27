export class ServiceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}
