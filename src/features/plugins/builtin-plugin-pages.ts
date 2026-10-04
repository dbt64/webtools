import TranslateView from '../translate/TranslateView.vue'

/** Literal bundled mapping; neither manifest fields nor package IDs are module paths. */
export function builtinPluginPage(key: 'translation'): typeof TranslateView {
  switch (key) { case 'translation': return TranslateView }
}
