'use strict'
window.__javascriptUrlExecuted = false
window.__navigationSecurityEvents = []
document.addEventListener('securitypolicyviolation', event => {
  window.__navigationSecurityEvents.push({ directive: event.violatedDirective, blockedScheme: (() => { try { return new URL(event.blockedURI).protocol.replace(':', '') } catch { return 'inline-or-opaque' } })() })
})
window.addEventListener('message', event => {
  if (event.data?.phase6e4a1FileSentinel === true) window.__probeFileSentinelAccessible = true
})
window.__navigationReady = true
