function selection(invocation) {
  invocation.signal.throwIfAborted()
  const context = invocation.context
  if (context?.type !== 'text' || context.source !== 'selected-text' || !context.text.trim() || context.text.length > 3000)
    throw new Error('This action requires a bounded selected-text context.')
  if (!invocation.webtools.external) throw new Error('This Host does not provide the external.open Command capability.')
  return context.text
}

exports.searchSelection = async invocation => {
  const text = selection(invocation)
  const url = new URL('https://www.bing.com/search')
  url.searchParams.set('q', text)
  await invocation.webtools.external.open(url.href)
}

exports.openSelectedLink = async invocation => {
  const text = selection(invocation).trim()
  const url = new URL(text)
  if (!/^https?:\/\//iu.test(text) || !['https:', 'http:'].includes(url.protocol)
    || url.username || url.password || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(text)) throw new Error('A complete HTTP(S) URL is required.')
  await invocation.webtools.external.open(text)
}
