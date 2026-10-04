<script setup lang="ts">
import { computed } from 'vue'
import { Save } from '@lucide/vue'
import type { PluginSetting, PluginSettingValue } from '../../shared/plugin-contracts.ts'

const props = defineProps<{ setting: PluginSetting; value: PluginSettingValue; error?: string; busy?: boolean; canSave?: boolean; idSuffix?: string }>()
const emit = defineEmits<{ 'update:value': [value: PluginSettingValue]; save: [] }>()
const inputId = computed(() => `plugin-setting-${props.setting.key}-${props.idSuffix ?? 'main'}`)
function changed(event: Event): void {
  if (props.setting.type === 'text' || props.setting.type === 'enum') emit('update:value', (event.target as HTMLInputElement | HTMLSelectElement).value)
  else if (props.setting.type === 'boolean') emit('update:value', (event.target as HTMLInputElement).checked)
  else emit('update:value', (event.target as HTMLInputElement).valueAsNumber)
}
</script>

<template>
  <div class="plugin-setting-editor">
    <label v-if="setting.type === 'text'" :for="inputId" class="plugin-setting-label">{{ setting.label }}<small>最多 {{ setting.maxLength }} 个字符</small></label>
    <label v-else-if="setting.type === 'enum'" :for="inputId" class="plugin-setting-label">{{ setting.label }}</label>
    <label v-else-if="setting.type === 'number'" :for="inputId" class="plugin-setting-label">{{ setting.label }}<small>{{ setting.min }} 至 {{ setting.max }}</small></label>
    <div v-if="setting.type === 'boolean'" class="plugin-setting-boolean">
      <input :id="inputId" type="checkbox" :checked="Boolean(value)" :disabled="!canSave || busy" :aria-invalid="Boolean(error)" @change="changed" />
      <label :for="inputId">{{ setting.label }}</label>
    </div>
    <input v-else-if="setting.type === 'text'" :id="inputId" type="text" :value="value" :maxlength="setting.maxLength" :disabled="!canSave || busy" :aria-invalid="Boolean(error)" @input="changed" />
    <select v-else-if="setting.type === 'enum'" :id="inputId" :value="value" :disabled="!canSave || busy" :aria-invalid="Boolean(error)" @change="changed"><option v-for="option in setting.options" :key="option" :value="option">{{ option }}</option></select>
    <input v-else type="number" :id="inputId" :value="value" :min="setting.min" :max="setting.max" step="any" :disabled="!canSave || busy" :aria-invalid="Boolean(error)" @input="changed" />
    <small v-if="error" class="plugin-field-error" role="alert">{{ error }}</small>
    <small v-else-if="!canSave" class="plugin-setting-readonly">没有声明可用的保存操作，此设置只读。</small>
    <button v-if="canSave" type="button" class="secondary-button plugin-save-setting" :disabled="Boolean(busy) || Boolean(error)" @click="emit('save')"><Save :size="13" />{{ busy ? '保存中…' : '保存设置' }}</button>
  </div>
</template>

<style scoped>
.plugin-setting-editor { display: grid; max-width: 620px; gap: 7px; color: var(--text); font-size: 10px; }
.plugin-setting-label { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-weight: 550; }
.plugin-setting-label small, .plugin-setting-readonly, .plugin-field-error { color: var(--muted); font-size: 9px; font-weight: 400; }
.plugin-setting-editor > input, .plugin-setting-editor > select { width: 100%; min-height: 36px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; color: var(--text); background: var(--surface); font: inherit; font-size: 11px; }
.plugin-setting-editor [aria-invalid='true'] { border-color: #c65f55; }
.plugin-field-error { color: #e09b91; }
.plugin-setting-boolean { display: flex; align-items: center; gap: 8px; }
.plugin-setting-boolean input { accent-color: var(--accent); }
.plugin-setting-boolean label { font-size: 10px; }
.plugin-save-setting { justify-self: start; }
</style>
