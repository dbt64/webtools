<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'

const props = defineProps<{ generation: number }>()
const surface = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined

function publishBounds(): void {
  const element = surface.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  window.desktop.webRuntime.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
}

function closeRuntime(): void { window.desktop.webRuntime.close(props.generation) }

watch(() => props.generation, () => { void nextTick(publishBounds) })

onMounted(() => {
  publishBounds()
  if (surface.value) {
    observer = new ResizeObserver(publishBounds)
    observer.observe(surface.value)
  }
  window.addEventListener('resize', publishBounds)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', publishBounds)
  window.desktop.webRuntime.close(props.generation)
})
</script>

<template>
  <section class="web-runtime-page">
    <header class="web-runtime-toolbar">
      <div><p class="eyebrow">隔离的 Web Feature</p><h1>Web Plugin Runtime</h1></div>
      <button class="secondary-button" type="button" @click="closeRuntime">
        <X :size="15" />关闭 Feature
      </button>
    </header>
    <div ref="surface" class="web-runtime-surface" aria-label="Web Plugin 内容区域" />
  </section>
</template>

<style scoped>
.web-runtime-page { position: absolute; inset: 62px 30px 24px; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.web-runtime-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; padding: 0 0 12px; }
.web-runtime-toolbar h1 { margin: 0; font-size: 18px; }
.web-runtime-toolbar .eyebrow { margin: 0 0 4px; }
.web-runtime-toolbar button { display: inline-flex; align-items: center; gap: 7px; }
.web-runtime-surface { position: relative; min-width: 0; min-height: 0; flex: 1; overflow: hidden; border-radius: 10px; background: var(--surface); }
</style>
