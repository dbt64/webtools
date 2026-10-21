// Closed discovery metadata. No plugin code, IO, language inference, or network.
export function matchesSelectedText(text, rule) {
  if (rule === undefined) return true
  if (rule !== 'http-url' || typeof text !== 'string' || text.length > 3000) return false
  const value = text.trim()
  if (!/^https?:\/\//iu.test(value)) return false
  for (const character of value) {
    const scalar = character.codePointAt(0)
    if (scalar <= 0x20 || scalar >= 0x7f && scalar <= 0x9f || scalar >= 0xd800 && scalar <= 0xdfff
      || /\s/u.test(character) || character === '\\') return false
  }
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/u, 1)[0]
  if (!authority || authority.includes('@')) return false
  const parts = authority.startsWith('[')
    ? /^\[([0-9a-f:]+)\](?::([0-9]+))?$/iu.exec(authority)
    : /^([^:]+)(?::([0-9]+))?$/u.exec(authority)
  if (!parts || parts[2] !== undefined && (parts[2].length > 5 || Number(parts[2]) < 1 || Number(parts[2]) > 65535)) return false
  const host = parts[1]
  if (authority.startsWith('[')) {
    const halves = host.split('::')
    if (halves.length > 2) return false
    const groups = halves.flatMap(half => half === '' ? [] : half.split(':'))
    return groups.every(group => /^[0-9a-f]{1,4}$/iu.test(group))
      && (halves.length === 2 ? groups.length < 8 : groups.length === 8)
  }
  if (host.length > 253 || [...host].some(character => character.codePointAt(0) > 0xffff)) return false
  const labels = (host.endsWith('.') ? host.slice(0, -1) : host).split('.')
  if (/^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(labels.at(-1) ?? '')) {
    return labels.length === 4 && labels.every(label => /^(?:0|[1-9][0-9]{0,2})$/u.test(label) && Number(label) <= 255)
  }
  // Syntactic eligibility only; not DNS reachability or full IDNA validation.
  return labels.every(label => label.length >= 1 && label.length <= 63
    && /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?$/u.test(label))
}
