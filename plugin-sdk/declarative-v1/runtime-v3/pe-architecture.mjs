export function inspectPeArchitecture(bytes) {
  if (!bytes || bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return undefined
  const peOffset = bytes.readUInt32LE(0x3c)
  if (peOffset + 24 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return undefined
  const coff = peOffset + 4
  const machine = bytes.readUInt16LE(coff)
  const optionalSize = bytes.readUInt16LE(coff + 16)
  const optional = coff + 20
  const magic = bytes.readUInt16LE(optional)
  const directoriesOffset = magic === 0x10b ? 96 : magic === 0x20b ? 112 : -1
  const directoryCountOffset = magic === 0x10b ? 92 : magic === 0x20b ? 108 : -1
  if (directoriesOffset < 0 || optionalSize < directoriesOffset + 15 * 8 || optional + optionalSize > bytes.length
    || bytes.readUInt32LE(optional + directoryCountOffset) < 15) return { machine, anyCpuManaged: false }

  const cliEntry = optional + directoriesOffset + 14 * 8
  const cliRva = bytes.readUInt32LE(cliEntry)
  const cliSize = bytes.readUInt32LE(cliEntry + 4)
  if (!cliRva || cliSize < 20) return { machine, anyCpuManaged: false }

  const sectionCount = bytes.readUInt16LE(coff + 2)
  const sections = optional + optionalSize
  for (let index = 0; index < sectionCount; index++) {
    const section = sections + index * 40
    if (section + 40 > bytes.length) return { machine, anyCpuManaged: false }
    const virtualSize = bytes.readUInt32LE(section + 8)
    const virtualAddress = bytes.readUInt32LE(section + 12)
    const rawSize = bytes.readUInt32LE(section + 16)
    const rawOffset = bytes.readUInt32LE(section + 20)
    const span = Math.max(virtualSize, rawSize)
    if (cliRva < virtualAddress || cliRva >= virtualAddress + span) continue
    const cliOffset = rawOffset + cliRva - virtualAddress
    if (cliOffset + 20 > bytes.length || bytes.readUInt32LE(cliOffset) < 20) return { machine, anyCpuManaged: false }
    const corFlags = bytes.readUInt32LE(cliOffset + 16)
    return { machine, anyCpuManaged: (corFlags & 0x1) !== 0 && (corFlags & 0x2) === 0 }
  }
  return { machine, anyCpuManaged: false }
}
