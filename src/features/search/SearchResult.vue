<script setup lang="ts">
import { Command, CornerDownLeft } from '@lucide/vue'
import type { AppSearchResult } from '@/shared/search'

defineProps<{
  result: AppSearchResult
  selected: boolean
}>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button class="result-row" :class="{ 'is-selected': selected }" @click="$emit('select')">
    <span class="result-app-icon"><Command :size="17" /></span>
    <span class="result-copy">
      <strong>{{ result.entry.name }}</strong>
      <small>{{ result.entry.targetPath }}</small>
    </span>
    <span class="result-match" v-if="result.match !== 'name'">{{ result.match === 'pinyin' ? '拼音' : '首字母' }}</span>
    <span v-if="selected" class="result-enter"><CornerDownLeft :size="13" /> 打开</span>
  </button>
</template>
