import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Electron Main owns only the Manager window and has no Launcher tray or hotkey', async () => {
  const main = await read('electron/main.ts')
  assert.doesNotMatch(main, /createLauncherWindow|launcherWindow|launcherVisibility|showLauncher|hideLauncher|toggleLauncher/)
  assert.doesNotMatch(main, /\bTray\b|\bGlobalHotkeyService\b|setLoginItemSettings|globalShortcut/)
  assert.equal((main.match(/new BrowserWindow\(/g) ?? []).length, 1)
})

test('Manager window retains Electron renderer isolation and sandboxing', async () => {
  const main = await read('electron/main.ts')
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /nodeIntegration:\s*false/)
  assert.match(main, /sandbox:\s*true/)
})

test('production renderer build has no Electron Launcher HTML or entrypoint', async () => {
  const vite = await read('electron.vite.config.ts')
  const packageJson = JSON.parse(await read('package.json'))
  assert.doesNotMatch(vite, /launcher\.html|launcher:\s*resolve/)
  assert.equal(packageJson.build.files.includes('out/**/*'), true)
  assert.equal(packageJson.scripts['package:win'].includes('build-native-production'), true)
})

test('preload and IPC contract expose no legacy Electron Launcher controls', async () => {
  const preload = await read('electron/preload.ts')
  const ipc = await read('src/shared/ipc.ts')
  for (const source of [preload, ipc]) {
    assert.doesNotMatch(source, /showLauncher|hideLauncher|setLauncherExpanded|moveLauncherBy|launcherVisibility|acknowledgeLauncherVisibility|getLauncherData|getWebsiteIcons|openTranslation/)
  }
  assert.match(preload, /contextBridge\.exposeInMainWorld\('desktop', desktopApi\)/)
  assert.match(ipc, /nativeManagerIntent/)
})

test('production installer enters through NativeHost and installs Electron under Manager', async () => {
  const script = await read('scripts/native-production.nsi')
  assert.match(script, /CreateShortcut "\$SMPROGRAMS\\WebTools\\WebTools\.lnk" "\$INSTDIR\\WebTools\.NativeHost\.exe"/)
  assert.match(script, /CreateShortcut "\$DESKTOP\\WebTools\.lnk" "\$INSTDIR\\WebTools\.NativeHost\.exe"/)
  assert.match(script, /SetOutPath "\$INSTDIR\\Manager"/)
  assert.match(script, /File \/r "stage\\manager\\\*\.\*"/)
  assert.match(script, /DeleteRegKey HKCU/)
  assert.doesNotMatch(script, /\$APPDATA\\Nook|\$APPDATA\\WebTools/)
})

test('NativeHost still owns login startup and resolves the packaged Manager executable', async () => {
  const startup = await read('native/WebTools.NativeHost/Services/LoginStartupService.cs')
  const launcher = await read('native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs')
  assert.match(startup, /Environment\.ProcessPath/)
  assert.match(launcher, /Path\.Combine\(executableDirectory, "Manager", "WebTools\.exe"\)/)
  assert.match(launcher, /ArgumentList\.Add\("--manager-only"\)/)
})

test('Native first-start migration from legacy Electron data remains implemented', async () => {
  const store = await read('native/WebTools.NativeHost/Data/LauncherStateStore.cs')
  assert.match(store, /ImportLegacy\(legacyDataPath/)
  assert.match(store, /legacyDataPath/)
})

test('packaged Electron connects to Native before creating its sole Manager window', async () => {
  const main = await read('electron/main.ts')
  assert.match(main, /const nativeManaged = app\.isPackaged \|\| isNativeManagerOnly/)
  const startup = main.slice(main.indexOf('app.whenReady().then'))
  assert.ok(startup.indexOf('await nativeManagerClient.connect()') < startup.indexOf('createWindow()'))
  assert.match(main, /builtinTranslationHandoff\?\.rendererReady\(\)/)
  assert.match(main, /if \(!nativeManaged \|\| !nativeManagerClient\?\.isConnected\) \{ deliverPendingNativeIntent\(\); return \}/)
})

test('normal Manager close and Native disconnect end the Electron process', async () => {
  const main = await read('electron/main.ts')
  assert.match(main, /window\.on\('close',[\s\S]*?window\.destroy\(\)/)
  assert.match(main, /window\.on\('closed',[\s\S]*?app\.quit\(\)/)
  assert.match(main, /nativeManagerClient\.onDisconnect\([\s\S]*?app\.quit\(\)/)
  assert.match(main, /app\.on\('before-quit',[\s\S]*?nativeManagerClient\?\.close\(\)/)
})

test('NativeHost owns production tray and launcher hotkey startup', async () => {
  const app = await read('native/WebTools.NativeHost/App.xaml.cs')
  const window = await read('native/WebTools.NativeHost/MainWindow.xaml.cs')
  const managerController = await read('native/WebTools.NativeHost/Services/ManagerController.cs')
  const main = await read('electron/main.ts')
  assert.match(app, /new TrayIconService\(/)
  assert.match(app, /RegisterHotkey\(/)
  assert.match(window, /RegisterHotkey/)
  assert.match(app, /OpenPage\(ManagerPage\.Favorites\)/)
  assert.match(window, /BrandButton_Click[\s\S]*?ManagerPage\.Favorites/)
  assert.match(managerController, /ManagerPage\.Favorites => "favorites"/)
  assert.doesNotMatch(main, /globalShortcut|new Tray|GlobalHotkeyService/)
})

test('website CRUD mutations synchronize their reduced projection back to Native', async () => {
  const handlers = await read('electron/ipc/website-handlers.ts')
  const main = await read('electron/main.ts')
  assert.match(handlers, /if \(result\.ok\) await deps\.onWebsitesChanged\(\)/)
  assert.match(main, /onWebsitesChanged: syncNativeWebsiteProjection/)
  assert.match(main, /projectWebsitesForNative\(dataStore\.snapshot\(\)\.webEntries\)/)
  assert.match(main, /nativeManagerClient\.request\('websites-update'/)
})

test('production Manager settings remain in Electron DataStore while Launcher settings use Native IPC', async () => {
  const handlers = await read('electron/ipc/settings-handlers.ts')
  assert.match(handlers, /updateNativeLauncherSettings\(nativeUpdate\)/)
  assert.match(handlers, /persistStandaloneLauncherPreferences/)
  assert.match(handlers, /sharedAI,[\s\S]*?translation:/)
  assert.doesNotMatch(handlers, /globalShortcut|setLoginItemSettings/)
})

test('production builder stages a self-contained NativeHost and a separate Electron Manager', async () => {
  const script = await read('scripts/build-native-production.ps1')
  assert.match(script, /publish[\s\S]*?--runtime", "win-x64"[\s\S]*?--self-contained", "true"/)
  assert.match(script, /electronBuilder,[\s\S]*?"--dir"/)
  assert.match(script, /Copy-Item -Path \(Join-Path \$unpackedManager "\*"\) -Destination \$managerStage/)
  assert.match(script, /native\\WebTools\.NativeHost\.Checks/)
})

test('installer smoke test is isolated and cannot uninstall the existing production install', async () => {
  const script = await read('scripts/build-native-production.ps1')
  const nsi = await read('scripts/native-production.nsi')
  assert.match(script, /native-production-\$stamp/)
  assert.match(script, /WebTools Phase 4F 中文 空格/)
  assert.match(script, /"\/PHASE4FTEST"/)
  assert.match(nsi, /StrCmp \$IsTestInstall "1" done/)
  assert.match(nsi, /\.phase4f-test-install/)
  assert.match(script, /Test-UninstallKey|Test-Path -LiteralPath \$testUninstallKey/)
})

test('installer limits previous-app discovery to known Native or versioned Electron Builder entries', async () => {
  const nsi = await read('scripts/native-production.nsi')
  assert.match(nsi, /StrCmp \$R1 "WebToolsNative" check_native_product/)
  assert.match(nsi, /StrCmp \$R2 "\$\{PRODUCT_NAME\}" matching_product next_key/)
  assert.match(nsi, /StrCpy \$R6 \$R2 "" 9/)
  assert.match(nsi, /StrCmp \$R7 "0" check_version_dot/)
  assert.match(nsi, /StrCmp \$R7 "9" check_version_dot next_key/)
  assert.match(nsi, /StrStr.*\$R7 \$R6 "\."/)
  assert.match(nsi, /StrStr.*\$R7 \$R6 " "/)
  assert.match(nsi, /StrStr.*\$R7 \$R3 "Uninstall WebTools\.exe"/)
  assert.doesNotMatch(nsi, /StrCmp \$R6 "\$\{PRODUCT_NAME\} " matching_product/)
  assert.match(nsi, /ReadRegStr \$R5 HKCU "\$\{RUN_KEY\}" "WebTools"/)
  assert.match(nsi, /WriteRegStr HKCU "\$\{RUN_KEY\}" "WebTools" '\"\$INSTDIR\\WebTools\.NativeHost\.exe\"'/)
})

test('installer offers normal shutdown and waits for previous uninstall before replacement', async () => {
  const builder = await read('scripts/build-native-production.ps1')
  const nsi = await read('scripts/native-production.nsi')
  assert.match(builder, /publish[\s\S]*?native\\WebTools\.UpdateHelper\\WebTools\.UpdateHelper\.csproj[\s\S]*?--runtime[\s\S]*?win-x64[\s\S]*?--self-contained[\s\S]*?true/)
  assert.match(builder, /stageRoot, "updater"|Join-Path \$stageRoot "updater"/)
  assert.match(builder, /WebTools\.UpdateHelper\.Checks/)

  const cleanup = nsi.slice(nsi.indexOf('Function RemovePreviousWebTools'), nsi.indexOf('FunctionEnd', nsi.indexOf('Function RemovePreviousWebTools')))
  assert.match(cleanup, /StrCmp \$IsTestInstall "1" done/)
  assert.match(nsi, /ReadRegStr \$R8 HKCU "\$\{UNINSTALL_ROOT\}\\\$R1" "InstallLocation"/)
  const helperCall = cleanup.indexOf('WebTools.UpdateHelper.exe')
  const previousUninstaller = cleanup.indexOf("ExecWait '$R3 /S _?=$R8'")
  assert.ok(helperCall >= 0 && helperCall < previousUninstaller, 'The helper must finish before the previous uninstaller starts.')
  assert.match(cleanup, /ExecWait '[^']*WebTools\.UpdateHelper\.exe[^']*--check-install[^']*\$R8[^']*' \$R9/)
  assert.match(nsi, /Page custom UpdatePageCreate UpdatePageLeave/)
  assert.match(nsi, /STR:退出后台/)
  assert.match(nsi, /--prepare-install/)
  assert.match(nsi, /STR:重试退出/)
  assert.match(cleanup, /IntCmp \$R9 10 previous_running/)
  assert.match(cleanup, /IntCmp \$R9 0[\s\S]*?Abort/)
  assert.match(cleanup, /StrCmp \$R8 "" update_location_failed/)
})

test('Native single instance owns launcher duplication independently of Manager process reuse', async () => {
  const app = await read('native/WebTools.NativeHost/App.xaml.cs')
  const controller = await read('native/WebTools.NativeHost/Services/ManagerController.cs')
  assert.ok(app.includes('Local\\WebTools.NativeHost'))
  assert.match(app, /WaitOne\(0, false\)/)
  assert.match(controller, /_managerProcess/)
  assert.match(controller, /if \(current is null \|\| current\.HasExited\)/)
  assert.match(controller, /_startGate/)
})

test('Manager starts on Favorites and has no Search page or Search-only app APIs', async () => {
  const app = await read('src/App.vue')
  const ipc = await read('src/shared/ipc.ts')
  const preload = await read('electron/preload.ts')
  const main = await read('electron/main.ts')
  assert.match(app, /activeSection = ref<Section>\('favorites'\)/)
  assert.match(app, /id: 'favorites', label: '网址'/)
  assert.match(app, /intent\.section === 'entries'\s*\?\s*'favorites'/)
  assert.doesNotMatch(app, /id: 'entries', label: '网址'/)
  assert.doesNotMatch(app, /SearchView|quick-search|id: 'search'/)
  assert.doesNotMatch(ipc, /getApps\(|refreshApps\(|getAppIcon\(|launchApp\(|getRememberedAppSearchAppId|rememberAppSearchResult|openSearch\(/)
  assert.doesNotMatch(preload, /getApps:|refreshApps:|getAppIcon:|launchApp:|getRememberedAppSearchAppId:|rememberAppSearchResult:|openSearch:/)
  assert.doesNotMatch(main, /AppCatalogService|AppLauncher|registerAppIpcHandlers|appCatalog\.refresh/)
  assert.match(main, /intent: \{ kind: 'open-page'; section: 'favorites' \| 'entries' \| 'settings' \}/)
  assert.match(main, /if \(command\.section === 'translate'\) \{\s*await beginNativeTranslationHandoff\(command\.requestId, null\)/)
  assert.match(await read('electron/services/native-manager-commands.ts'), /section: 'favorites' \| 'entries' \| 'settings' \| 'translate'/)
  assert.doesNotMatch(await read('src/shared/domain.ts'), /interface AppSearchEntry/)
})

test('Favorites groups are collapsible and use a compact width-driven CSS grid', async () => {
  const favorites = await read('src/features/favorites/FavoritesView.vue')
  const styles = await read('src/styles/tokens.css')
  assert.match(favorites, /buildFavoriteSections/)
  assert.match(favorites, /aria-expanded/)
  assert.match(favorites, /listBookmarkFolders/)
  assert.match(favorites, /saveBookmarkFolder/)
  assert.match(favorites, /deleteBookmarkFolder/)
  assert.match(favorites, /listWebsites/)
  assert.match(favorites, /getWebsiteOrder/)
  assert.match(favorites, /window\.desktop\.reorderWebsites/)
  assert.match(favorites, /window\.desktop\.addWebsiteToFolders/)
  assert.match(favorites, /<DeleteConfirmationDialog/)
  assert.doesNotMatch(favorites, /window\.confirm/)
  assert.match(favorites, /initial-folder-ids/)
  assert.match(favorites, /window\.desktop\.saveWebsite/)
  assert.match(favorites, /window\.desktop\.openWebsite\(website\.id\)/)
  assert.match(favorites, /window\.desktop\.deleteWebsite/)
  assert.match(favorites, /:draggable="editMode"/)
  assert.match(favorites, /:title="website\.name"/)
  assert.doesNotMatch(favorites, /window\.prompt/)
  const folderDialog = await read('src/features/favorites/FolderNameDialog.vue')
  assert.match(folderDialog, /role="dialog" aria-modal="true"/)
  assert.match(folderDialog, /emit\('save', value\)/)
  assert.match(styles, /repeat\(auto-fill,\s*minmax\(180px,\s*1fr\)\)/)
  assert.match(styles, /favorite-bookmark-title[\s\S]*?text-overflow:\s*ellipsis/)
  assert.doesNotMatch(styles, /favorite-bookmark-grid\s*\{[^}]*repeat\(\s*[3-8]\s*,/)
})
