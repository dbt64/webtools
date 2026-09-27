import { onScopeDispose, ref, watch, type ComputedRef } from 'vue'

export function useAppResultIcons(appIds: ComputedRef<string[]>) {
  const icons = ref<Record<string, string>>({})
  let requestGeneration = 0

  watch(appIds, (ids) => {
    const generation = ++requestGeneration
    const currentIds = new Set(ids)
    for (const id of Object.keys(icons.value)) if (!currentIds.has(id)) delete icons.value[id]

    for (const id of ids) {
      if (icons.value[id]) continue
      void window.desktop.getAppIcon(id).then((result) => {
        if (generation !== requestGeneration || !appIds.value.includes(id)) return
        if (result.ok && result.data.dataUrl) icons.value[id] = result.data.dataUrl
      }).catch(() => undefined)
    }
  }, { immediate: true })

  onScopeDispose(() => { requestGeneration++ })
  return icons
}
