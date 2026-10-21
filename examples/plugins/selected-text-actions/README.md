# Selected Text Actions

Optional real Manifest v3 Node Command example. It uses only the public `@webtools/plugin-sdk/node` entry and the existing `external.open` capability; it is not installed automatically. The build bundles each command and its public SDK adapter into `assets/` before the official SDK builds and packs it. An installed plugin has no access to the author's `node_modules`.

- **搜索选中文字** accepts ordinary selected text, including Chinese/mixed text, and opens a Bing HTTPS search after the user clicks it. The exact selection is URL-encoded into the query. Bing receives that query through the browser; capture/discovery alone sends nothing.
- **打开选中链接** appears for the Host's bounded `http-url` content rule. Clicking it opens the selected HTTP(S) URL in the system browser. The original context is unchanged; only outer whitespace is removed for opening.

Install permission and a current explicit activation are required. Each invocation has a one-use external-open gesture. No clipboard, AI, SecretStore, private IPC, persistence, or custom native process is used by this example. Node packages still execute with the current Windows user's ordinary OS permissions.

## External author workflow

Copy this directory outside the WebTools checkout, for example under `D:\SystemDefault\Desktop\webtoolstest`. Create the SDK 1.8.0 tarball from the reviewed SDK package, then install that exact local file:

```powershell
pnpm add --save-exact "@webtools/plugin-sdk@file:D:/path/to/webtools-plugin-sdk-1.8.0.tgz"
pnpm install --frozen-lockfile
pnpm run build
pnpm run validate
pnpm run pack
pnpm run inspect
```

Install `selected-text-actions.wtplugin` only into the intended test installation and enable its requested capability. The Host repeats authoritative archive validation. An older Host/SDK may reject the new field or lack the optional Command API; `minHostVersion: 0.1.0` cannot distinguish different development snapshots using the same product version. Use a Host implementing Phase 6G-2; do not invent a newer product version or bypass validation.

The first rule supports HTTP(S), BMP Unicode domain labels, canonical dotted IPv4, hex-group IPv6 (without scoped addresses or embedded IPv4), and ports 1–65535. It deliberately rejects partial URLs, credentials, internal whitespace/controls, backslashes, numeric alternate IPv4 spellings and unsupported schemes. Recognition is a deterministic local shape filter bounded to the existing 3,000 UTF-16-unit selection limit; it does not guarantee full IDNA/A-label validity or DNS reachability. Activation still uses the current Host URL and permission checks; a browser may refuse an otherwise matching address. URL-shaped text still also matches ordinary text actions such as Translation.
