import { connectWebTools, type WebToolsConnection, type WebToolsError } from '@webtools/plugin-sdk/web'

const connection: WebToolsConnection = connectWebTools()
const ready: Promise<void> = connection.ready
const unsubscribe: () => void = connection.onClose(() => {})
void ready; void unsubscribe
function readError(error: WebToolsError): false { return error.retryable }
void readError
// @ts-expect-error Generic method-string requests are not part of the supported API.
connection.request('bridge.ping', null)
