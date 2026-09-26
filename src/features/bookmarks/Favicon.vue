<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ url: string; favicon?: string }>()
const failed = ref(false)
const initial = computed(() => {
  try {
    const hostname = new URL(props.url).hostname.replace(/^www\./i, '')
    return [...hostname].find((character) => /[\p{L}\p{N}]/u.test(character))?.toLocaleUpperCase() ?? '?'
  } catch {
    return '?'
  }
})
watch(() => props.favicon, () => { failed.value = false })
</script>

<template>
  <img v-if="favicon && !failed" class="favicon-image" :src="favicon" alt="" @error="failed = true" />
  <span v-else class="favicon-fallback">{{ initial }}</span>
</template>
