const result = { attempted: [], completed: {}, popup: null, frame: null, serviceWorker: null }
window.__networkProbe = result
const target = new URLSearchParams(location.search).get('target')

async function attempt(name, work) {
  result.attempted.push(name)
  try { result.completed[name] = (await work()) ?? 'completed' }
  catch (error) { result.completed[name] = error.name || 'rejected' }
}

async function run() {
  await attempt('fetch', () => fetch(target))
  const httpsTarget = target.replace(/^http:/, 'https:')
  await attempt('https-fetch', () => fetch(httpsTarget))
  await attempt('xhr', () => new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('GET', target); xhr.onload = resolve; xhr.onerror = () => reject(new Error('network error')); xhr.send() }))
  await attempt('event-source', () => new Promise((resolve, reject) => { const es = new EventSource(target); es.onopen = resolve; es.onerror = () => { es.close(); reject(new Error('eventsource error')) }; setTimeout(() => { es.close(); reject(new Error('timeout')) }, 500) }))
  await attempt('websocket', () => new Promise((resolve, reject) => { const ws = new WebSocket(target.replace(/^http/, 'ws')); ws.onopen = () => { ws.close(); resolve() }; ws.onerror = () => reject(new Error('websocket error')); setTimeout(() => reject(new Error('timeout')), 500) }))
  await attempt('secure-websocket', () => new Promise((resolve, reject) => { const ws = new WebSocket(httpsTarget.replace(/^https/, 'wss')); ws.onopen = () => { ws.close(); resolve() }; ws.onerror = () => reject(new Error('secure websocket error')); setTimeout(() => reject(new Error('timeout')), 500) }))
  await attempt('remote-script', () => new Promise(resolve => { const script = document.createElement('script'); script.src = `${target}.js`; script.onload = () => resolve('loaded'); script.onerror = () => resolve('blocked'); document.head.append(script); setTimeout(() => resolve('timeout'), 500) }))
  await attempt('remote-css-image-font', async () => {
    const image = new Image(); image.src = `${target}.png`
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = `${target}.css`; document.head.append(style)
    const font = new FontFace('RemoteProbe', `url(${target}.woff2)`); await font.load()
  })
  await attempt('service-worker', () => navigator.serviceWorker.register('./worker.js'))
  await attempt('redirect', () => fetch(new URL('/redirect', location.href)))
  await attempt('permission-geolocation', () => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(() => resolve(), error => reject(new Error(`geolocation-${error.code}`)), { timeout: 500 })))
  result.popup = window.open(target, '_blank') === null ? 'denied' : 'opened'
  const frameAttempts = [
    ['http', target],
    ['file', 'file:///C:/Windows/win.ini'],
    ['data', 'data:text/html,blocked-navigation-probe'],
    ['blob', URL.createObjectURL(new Blob(['blocked-navigation-probe'], { type: 'text/html' }))],
    ['javascript', 'javascript:void(0)'],
  ]
  result.frame = []
  for (const [scheme, url] of frameAttempts) { const frame = document.createElement('iframe'); frame.src = url; frame.dataset.scheme = scheme; document.body.append(frame); result.frame.push(scheme) }
  const link = document.createElement('a'); link.href = target; link.target = '_blank'; link.textContent = 'external navigation probe'; document.body.append(link); link.click()
  const sameTabLink = document.createElement('a'); sameTabLink.href = target; sameTabLink.textContent = 'top-level navigation probe'; document.body.append(sameTabLink); sameTabLink.click()
  const download = document.createElement('a'); download.href = new URL('/download.txt', location.href).href; download.download = 'phase6e4a.txt'; download.click()
  result.downloadAttempted = true
  await new Promise(resolve => setTimeout(resolve, 300))
  window.__networkProbeReady = true
}

run().catch(error => { result.fatal = String(error); window.__networkProbeReady = true })
