import { connectWebTools, type WebToolsConnection, type WebToolsError } from '@webtools/plugin-sdk/web'

const connection: WebToolsConnection = connectWebTools()
const ready: Promise<void> = connection.ready
const unsubscribe: () => void = connection.onClose(() => {})
void ready; void unsubscribe
void connection.context.current()
void connection.storage.get('key')
void connection.storage.set('key', { value: true })
void connection.storage.delete('key')
void connection.ai?.complete({ prompt: 'hello' }, { signal: new AbortController().signal })
void connection.clipboard?.writeText('hello')
// @ts-expect-error Provider selection is not Plugin authority.
connection.ai?.complete({ prompt: 'hello', providerId: 'forged' })
// @ts-expect-error External open remains deferred.
connection.external.open('https://example.org')
function readError(error: WebToolsError): false { return error.retryable }
void readError
// @ts-expect-error Generic method-string requests are not part of the supported API.
connection.request('bridge.ping', null)
