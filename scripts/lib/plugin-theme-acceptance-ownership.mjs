// Test tooling only: a matching executable path is necessary but does not give
// this run ownership of a process which was already present at preflight.
export class ThemeAcceptanceOwnership {
  constructor(nativePath, managerPath) {
    this.nativePath = nativePath.toLowerCase()
    this.managerPath = managerPath.toLowerCase()
    this.identities = new Map()
  }
  same(left, right) {
    return left?.pid === right?.pid && left?.created === right?.created &&
      typeof left?.path === 'string' && left.path.toLowerCase() === right?.path?.toLowerCase()
  }
  claimNative(rows, spawnedPid, parentPid) {
    if (this.identities.size) return false
    const native = rows.find(row => row.pid === spawnedPid && row.parentPid === parentPid &&
      row.role === 'native' && row.path?.toLowerCase() === this.nativePath && row.created)
    if (!native) return false
    this.identities.set(native.pid, { ...native })
    return true
  }
  observe(rows) {
    let added
    do {
      added = false
      for (const row of rows) {
        if (this.identities.has(row.pid) || row.path?.toLowerCase() !== this.managerPath || !row.created) continue
        const parent = rows.find(candidate => candidate.pid === row.parentPid)
        if (!parent || !this.same(parent, this.identities.get(parent.pid))) continue
        if (Date.parse(row.created) < Date.parse(parent.created)) continue
        this.identities.set(row.pid, { ...row }); added = true
      }
    } while (added)
  }
  live(rows) { return rows.filter(row => this.same(row, this.identities.get(row.pid))) }
}
