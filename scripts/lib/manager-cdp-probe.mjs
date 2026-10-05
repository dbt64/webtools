function waitForSocket(socket, stage, label, timeoutMs, expression) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timeout)
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('error', onError)
      socket.removeEventListener('close', onClose)
      if (error) reject(error)
      else resolve(value)
    }
    const onOpen = () => finish()
    const onError = () => finish(new Error(`${label} ${stage}: socket error.`))
    const onClose = () => finish(new Error(`${label} ${stage}: socket closed.`))
    const onMessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.id !== 1) return
        if (message.error || message.result?.exceptionDetails) finish(new Error(`${label} ${stage}: ${JSON.stringify(message)}`))
        else finish(null, message.result?.result?.value)
      } catch (error) { finish(error) }
    }
    const timeout = setTimeout(() => finish(new Error(`${label} ${stage} timed out.`)), timeoutMs)
    socket.addEventListener('error', onError)
    socket.addEventListener('close', onClose)
    if (stage === 'open') socket.addEventListener('open', onOpen)
    else {
      socket.addEventListener('message', onMessage)
      try {
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
      } catch (error) { finish(error) }
    }
  })
}

// Test driver only: every endpoint wait is bounded and every exit closes its socket.
export async function withManagerCdpProbe(socket, { expression, label = 'Manager renderer', timeoutMs = 10_000 }, verify) {
  try {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error('Manager CDP timeout must be between 1 and 60000 ms.')
    await waitForSocket(socket, 'open', label, timeoutMs)
    const value = await waitForSocket(socket, 'evaluation', label, timeoutMs, expression)
    return await verify(value)
  } finally { socket.close() }
}
