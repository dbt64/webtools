import type { AppSearchEntry, LauncherDataChanges, LauncherDataVersions, WebsiteSearchEntry } from '../../src/shared/domain.ts'

interface AppCatalogPort { list(): AppSearchEntry[] }
interface WebsiteLauncherPort {
  listForLauncher(): WebsiteSearchEntry[]
  getIcons(ids: string[]): Record<string, string | null>
}

export class LauncherDataService {
  private versions: LauncherDataVersions = { apps: 0, websites: 0 }
  private readonly appCatalog: AppCatalogPort
  private readonly websiteService: WebsiteLauncherPort

  constructor(
    appCatalog: AppCatalogPort,
    websiteService: WebsiteLauncherPort,
  ) {
    this.appCatalog = appCatalog
    this.websiteService = websiteService
  }

  markAppsChanged(): number { return ++this.versions.apps }
  markWebsitesChanged(): number { return ++this.versions.websites }

  getChanges(known: LauncherDataVersions): LauncherDataChanges {
    const versions = { ...this.versions }
    return {
      versions,
      ...(known.apps === versions.apps ? {} : { apps: this.appCatalog.list() }),
      ...(known.websites === versions.websites ? {} : { websites: this.websiteService.listForLauncher() }),
    }
  }

  getWebsiteIcons(ids: string[]): Record<string, string | null> {
    return this.websiteService.getIcons(ids)
  }
}
