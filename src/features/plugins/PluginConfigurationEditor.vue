<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import type { PluginConfigurationIdentity } from '../../shared/plugin-contracts.ts'
import { PluginConfigurationEditorModel } from './plugin-configuration-editor-model.ts'
import PluginSettingEditor from './PluginSettingEditor.vue'

const props = defineProps<{ identity: PluginConfigurationIdentity }>()
const emit = defineEmits<{ busy: [value: boolean]; dirty: [value: boolean] }>()
const model = reactive(new PluginConfigurationEditorModel(window.desktop.plugins))
const editing = computed(() => model.state?.status === 'ready' && !model.busy && !model.loading)
watch([() => props.identity.pluginId, () => props.identity.version, () => props.identity.hash], () => void model.select(props.identity), { immediate: true })
watch(() => model.busy, value => emit('busy', value), { immediate: true })
watch(() => model.dirty, value => emit('dirty', value), { immediate: true })
onBeforeUnmount(() => { model.dispose(); emit('busy', false); emit('dirty', false) })
function confirmLeave(): boolean {
  if (model.busy) return false
  return !model.dirty || window.confirm('放弃尚未保存的插件设置并离开当前页面？')
}
defineExpose({ confirmLeave })
function reload(): void {
  if (!model.dirty || window.confirm('放弃尚未保存的插件设置并重新读取？')) void model.select(props.identity)
}
</script>

<template>
  <div class="plugin-configuration-editor" :aria-busy="model.loading || model.busy">
    <p class="configuration-note">设置由 WebTools 管理，插件停用时也可以编辑。此处用于普通偏好，不用于保存密钥。</p>
    <p v-if="model.loading" role="status">正在读取插件设置…</p>
    <p v-else-if="model.state?.status === 'unavailable'" class="configuration-note">此插件没有声明可用配置。</p>
    <template v-else-if="model.state">
      <p v-if="model.state.status === 'incompatible'" role="alert" class="configuration-error">保存的设置与当前插件版本不兼容，原文件仍已保留。确认恢复默认设置后可以重新编辑。</p>
      <div v-else class="configuration-fields">
        <PluginSettingEditor v-for="setting in model.settings" :key="setting.key" :setting="setting" :value="model.draft[setting.key]" :error="model.errors[setting.key]" :can-save="editing" :busy="model.busy" :show-save-button="false" :id-suffix="identity.pluginId" @update:value="model.draft[setting.key] = $event" />
        <p v-if="model.settings.length === 0" class="configuration-note">此插件暂未提供配置项。</p>
      </div>
      <div class="configuration-actions">
        <template v-if="model.state.status === 'ready'">
          <button type="button" class="primary-button" :disabled="!editing || !model.dirty || Object.keys(model.errors).length > 0" @click="model.save()">{{ model.busy ? '正在保存…' : '保存设置' }}</button>
          <button type="button" class="secondary-button" :disabled="model.busy || !model.dirty" @click="model.cancel()">取消修改</button>
        </template>
        <button type="button" class="secondary-button" :disabled="model.busy" @click="model.reset()">恢复默认设置</button>
      </div>
    </template>
    <p v-if="model.message" :role="model.messageKind === 'error' ? 'alert' : 'status'" :class="{ 'configuration-error': model.messageKind === 'error' }">{{ model.message }}</p>
    <button type="button" class="text-button" :disabled="model.loading || model.busy" @click="reload">重新读取设置</button>
  </div>
</template>

<style scoped>
.plugin-configuration-editor { display: grid; gap: calc(var(--manager-unit) * 1.25); color: var(--text); font-size: var(--manager-font-small); }
.plugin-configuration-editor p { margin: 0; line-height: 1.6; }
.configuration-note { color: var(--muted); }
.configuration-fields { display: grid; gap: calc(var(--manager-unit) * 1.75); }
.configuration-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--manager-unit); }
.configuration-error { color: var(--plugin-danger, #c65f55); }
.plugin-configuration-editor > .text-button { justify-self: start; }
</style>
