import { onScopeDispose, ref, watch, type ComputedRef } from 'vue'

export function useWebsiteIcons(websiteDataVersion: ComputedRef<number>) {
  const icons = ref<Record<string, string>>({})
  const visibleResultIds = ref<string[]>([])
  const visibleShortcutIds = ref<string[]>([])
  let activeIds = new Set<string>()
  let currentVersion = websiteDataVersion.value
  let nextRequestId = 0
  const resolvedIds = new Set<string>()
  const requestIds = new Map<string, number>()

  function replaceIds(target: typeof visibleResultIds, ids: string[]): void {
    if (target.value.length === ids.length && target.value.every((id, index) => id === ids[index])) return
    target.value = ids
  }

  function refresh(): void {
    const version = websiteDataVersion.value
    if (version !== currentVersion) {
      currentVersion = version
      icons.value = {}
      resolvedIds.clear()
      requestIds.clear()
    }

    activeIds = new Set([...visibleResultIds.value, ...visibleShortcutIds.value])
    for (const id of Object.keys(icons.value)) if (!activeIds.has(id)) delete icons.value[id]
    for (const id of resolvedIds) if (!activeIds.has(id)) resolvedIds.delete(id)
    for (const id of requestIds.keys()) if (!activeIds.has(id)) requestIds.delete(id)

    const missing = [...activeIds].filter((id) => !resolvedIds.has(id) && !requestIds.has(id))
    if (!missing.length) return

    const requestId = ++nextRequestId
    const requestVersion = version
    for (const id of missing) requestIds.set(id, requestId)
    void window.desktop.getWebsiteIcons(missing).then((result) => {
      if (requestVersion !== websiteDataVersion.value) return
      const next = { ...icons.value }
      for (const id of missing) {
        if (requestIds.get(id) !== requestId || !activeIds.has(id)) continue
        resolvedIds.add(id)
        const icon = result[id]
        if (icon) next[id] = icon
      }
      icons.value = next
    }).catch(() => {
      if (requestVersion === websiteDataVersion.value) {
        for (const id of missing) if (requestIds.get(id) === requestId && activeIds.has(id)) resolvedIds.add(id)
      }
    }).finally(() => {
      for (const id of missing) if (requestIds.get(id) === requestId) requestIds.delete(id)
      refresh()
    })
  }

  watch([websiteDataVersion, visibleResultIds, visibleShortcutIds], refresh, { immediate: true, deep: true })
  onScopeDispose(() => { activeIds.clear(); resolvedIds.clear(); requestIds.clear() })

  return {
    icons,
    setVisibleResultIds(ids: string[]) { replaceIds(visibleResultIds, ids) },
    setVisibleShortcutIds(ids: string[]) { replaceIds(visibleShortcutIds, ids) },
  }
}
