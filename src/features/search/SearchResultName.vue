<script setup lang="ts">
import { computed } from 'vue'
import { getSearchHighlightParts } from '@/shared/search'

const props = defineProps<{
  name: string
  query: string
}>()

const parts = computed(() => getSearchHighlightParts(props.name, props.query))
</script>

<template>
  <strong>
    <template v-for="(part, index) in parts" :key="index">
      <mark v-if="part.highlighted" class="search-highlight">{{ part.text }}</mark>
      <span v-else>{{ part.text }}</span>
    </template>
  </strong>
</template>

<style scoped>
.search-highlight { padding: 0; color: #f97316; background: transparent; font: inherit; }
</style>
