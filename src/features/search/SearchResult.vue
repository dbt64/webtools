<script setup lang="ts">
import { BookmarkPlus, Command, CornerDownLeft, Globe, Wrench } from '@lucide/vue'
import { ref, watch } from 'vue'
import type { SearchResult } from '@/shared/search'
import SearchResultName from './SearchResultName.vue'

const props = defineProps<{
  result: SearchResult
  selected: boolean
  query: string
  iconUrl?: string
}>()

defineEmits<{ select: []; bookmark: [] }>()
const iconFailed = ref(false)
watch(() => props.iconUrl, () => { iconFailed.value = false })
</script>

<template>
  <div class="result-line">
    <button class="result-row" :class="{ 'is-selected': selected }" @click="$emit('select')">
      <span class="result-app-icon" :class="`result-${result.entry.kind}`">
        <img v-if="result.entry.kind === 'app' && iconUrl && !iconFailed" :src="iconUrl" alt="" @error="iconFailed = true" />
        <Command v-else-if="result.entry.kind === 'app'" :size="17" />
        <Globe v-else-if="result.entry.kind === 'website'" :size="17" />
        <Wrench v-else :size="17" />
      </span>
      <span class="result-copy"><SearchResultName :name="result.entry.name" :query="query" /><small>{{ result.entry.subtitle }}</small></span>
      <span class="result-match" v-if="result.match !== 'name'">{{ result.match === 'pinyin' ? '拼音' : result.match === 'alias' ? '别名' : '首字母' }}</span>
      <span v-if="selected" class="result-enter"><CornerDownLeft :size="13" /> 打开</span>
    </button>
    <button v-if="result.entry.kind === 'website'" class="result-bookmark" :aria-label="`收藏${result.entry.name}`" title="收藏网址" @click="$emit('bookmark')"><BookmarkPlus :size="16" /></button>
  </div>
</template>

<style scoped>
.result-app-icon img { width: 24px; height: 24px; object-fit: contain; }
</style>
