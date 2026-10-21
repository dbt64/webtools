# Plugin Window Theme and UI Contract

Phase 6F-4E supplies optional color semantics to the existing Manifest v3 WebContentsView. It does not provide components or require a plugin to adopt WebTools page styling. No permission, Manifest field, SDK helper, or framework dependency is required.

## UI ownership

| Surface | Owner and guarantee |
| --- | --- |
| Launcher/search input, search results, Feature launch entries | WebTools renders the platform UI and controls its presentation and interaction. |
| Plugin Center, permission/configuration management, existing declarative compatibility pages | WebTools renders the Host-owned surface. |
| Independent Plugin Window shell | Host owns title/icon, outer background, size constraints, focus, reuse and close lifecycle. Windows still controls native titlebar decoration. |
| Plugin content page | The plugin owns HTML/CSS/JS, layout, spacing, typography, controls, icons, navigation and page accessibility. |

A plugin that ignores the variables continues to use its own styles. Its page can differ from the Host and other plugins. Compatibility does not promise visual parity. Host-rendered pages can offer stricter consistency; a mandatory SDK/UI component contract would need a separate design and adoption decision.

## Theme source and timing

The source is the saved WebTools `AppSettings.theme` value:

- `light` / `dark`: the corresponding palette, independent of the Windows theme.
- `system`: Electron's Windows dark/light signal, updated live through `nativeTheme.updated`.

The Host does not change global `nativeTheme.themeSource` or Windows personalization. A settings change is published only after the existing settings owner accepts/persists it. With NativeHost-managed settings, that owner remains NativeHost; no parallel setting is stored.

For each runtime document, Host CSS installation is attempted after document load and before bridge READY/window reveal. Open windows receive effective-theme changes without a reload. Replacement is serialized, keeps the previous stylesheet until the new one is installed, and is bound to the active runtime generation. Close/revocation/reload releases the subscription and styles; late work cannot style a replacement runtime.

Theme is optional presentation. If insertion fails, the plugin keeps its fallback or previous styling; the failure does not grant capabilities or fault an otherwise valid plugin. A fixed, sanitized warning is emitted. This fallback is not a claim that the new theme was applied.

## CSS scope and values

The entire Host stylesheet is one `:root` rule containing only the following custom properties. Other selectors, element styles, page colors, control styling, fonts, layout, animations and `!important` rules are excluded. The values are fixed Host literals, never plugin CSS or user configuration strings.

| Custom property | Light | Dark |
| --- | --- | --- |
| `--webtools-color-scheme` | `light` | `dark` |
| `--webtools-color-background` | `#f3f5f8` | `#0b0c0e` |
| `--webtools-color-surface` | `#ffffff` | `#18191b` |
| `--webtools-color-surface-raised` | `#f7f9fb` | `#202124` |
| `--webtools-color-text` | `#1b2633` | `#f4f4f5` |
| `--webtools-color-muted` | `#5f6f80` | `#a1a1aa` |
| `--webtools-color-border` | `#e5eaf0` | `#303237` |
| `--webtools-color-accent` | `#2477f3` | `#91baff` |
| `--webtools-color-accent-foreground` | `#ffffff` | `#111b2c` |

`--webtools-color-scheme` is only a custom property. It does not automatically set the real CSS `color-scheme` property or recolor browser controls. A plugin must consume it explicitly. Likewise, color tokens do not style buttons, spacing, forms or icons automatically.

## Opt-in styles

The following is **plugin-authored CSS**, not Host injection. Save it as `theme.css` in the plugin's own project and customize the business UI as needed:

```css
:root {
  color-scheme: var(--webtools-color-scheme, light dark);
}
body {
  margin: 0;
  color: var(--webtools-color-text, #1b2633);
  background: var(--webtools-color-background, #f3f5f8);
}
.surface {
  background: var(--webtools-color-surface, #fff);
  border: 1px solid var(--webtools-color-border, #e5eaf0);
}
```

Ordinary CSS imports work in every supported framework:

| Framework | Entry integration |
| --- | --- |
| Vanilla | Add `<link rel="stylesheet" href="./theme.css">` or import it from the Vite entry. |
| Vue | `import './theme.css'` in the entry that calls `createApp(App).mount('#app')`. |
| React | `import './theme.css'` in the entry that calls `createRoot(...).render(...)`. |
| Svelte | `import './theme.css'` in the entry that mounts the Svelte component. |

CSS variable consumers update through the CSS cascade when the Host replaces values. No bridge call or theme-event SDK helper is needed. Public helpers/starter synchronization belong to Phase 6F-5.

The injected value represents the **effective WebTools preference**, including a saved light/dark override. `prefers-color-scheme` and `matchMedia` represent the runtime's system preference and may differ from an explicit WebTools preference. Use the injected variable when following WebTools; use a media query when deliberately following the OS independently. In WebTools `system` mode the variables follow Windows automatically.

Fallbacks allow the same page to run outside a themed Host. A plugin that does not use any variable keeps its own style and may not adapt to the Host theme at all.

## Accessibility and limitations

Authors remain responsible for semantic controls, labels, tab order, visible focus, keyboard use, scaling and contrast of their own composition. Host window behavior does not repair inaccessible content.

The inherited palette's text/surface contrast is 15.31:1 (light) and 16.00:1 (dark); muted/surface is 5.16:1 and 6.86:1. The accent-foreground/accent pair is **4.19:1 in light mode** and 8.77:1 in dark mode. The light accent pair does not meet 4.5:1 for normal-size text: use it for large text/non-text accents, or choose an author-controlled accessible pairing. Theme tokens alone do not imply WCAG compliance. Values use the approved existing palette; this phase does not redesign Manager colors.

No Host UI kit, required style library, plugin migration, arbitrary CSS input, theme capability/permission, or plugin access to global settings is introduced. Existing declarative pages keep their Host renderer; this CSS contract targets independent Manifest v3 Window Features.

## uTools reference boundary

Official uTools documentation describes [developer-authored Web front ends](https://next.u-tools.cn/docs/development/plugin-architecture.html), [Feature metadata](https://next.u-tools.cn/docs/development/plugin-json.html), [theme detection and `prefers-color-scheme`](https://next.u-tools.cn/docs/api-reference/system.html), and [`insertCSS()` on custom windows](https://next.u-tools.cn/docs/api-reference/window.html). Those APIs do not establish that every plugin page is forcibly restyled or must use one component library. Local 7.8.0 ASAR observations and the installer PE are separate evidence sources; see the approved 6F-4E implementation plan for their limits.
