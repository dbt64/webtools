'use strict'

const { randomBytes } = require('node:crypto')

const HOST_PATTERN = /^[0-9a-f]{32}$/

function createRuntimeHost() {
  return randomBytes(16).toString('hex')
}

function buildRuntimeOrigin(host) {
  if (typeof host !== 'string' || !HOST_PATTERN.test(host)) throw new TypeError('Invalid runtime host')
  return `webtools-plugin://${host}`
}

function buildCsp({ wasm = false, probeConnectOrigin = null } = {}) {
  const connect = probeConnectOrigin ? `'self' ${probeConnectOrigin}` : "'self'"
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    `script-src 'self'${wasm ? " 'wasm-unsafe-eval'" : ''}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
  ].join('; ')
}

function allowsRuntimeUrl(rawUrl, expectedOrigin) {
  try {
    const url = new URL(rawUrl)
    const origin = new URL(expectedOrigin)
    return url.protocol === 'webtools-plugin:'
      && origin.protocol === 'webtools-plugin:'
      && /^[0-9a-f]{32}$/.test(url.hostname)
      && url.hostname === origin.hostname
      && !url.username && !url.password && !url.port
  } catch {
    return false
  }
}

module.exports = { createRuntimeHost, buildRuntimeOrigin, buildCsp, allowsRuntimeUrl }
