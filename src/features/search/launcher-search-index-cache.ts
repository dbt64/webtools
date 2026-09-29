import { buildSearchIndex, type SearchIndex } from '../../shared/pinyin-index.ts'

interface IndexedLauncherEntry { id: string; name: string; searchText?: string; aliases?: string[] }

function sameSearchData<T extends IndexedLauncherEntry>(left: readonly T[] | undefined, right: readonly T[]): boolean {
  if (left === right) return true
  if (!left || left.length !== right.length) return false
  return left.every((entry, index) => {
    const other = right[index]
    return entry.id === other.id
      && entry.name === other.name
      && entry.searchText === other.searchText
      && entry.aliases?.length === other.aliases?.length
      && (entry.aliases ?? []).every((alias, aliasIndex) => alias === other.aliases?.[aliasIndex])
  })
}

/** Rebuilds pinyin data only for the app or website dataset whose array changed. */
export class LauncherSearchIndexCache<T extends IndexedLauncherEntry> {
  private appEntries: readonly T[] | undefined
  private websiteEntries: readonly T[] | undefined
  private appIndex: SearchIndex = new Map()
  private websiteIndex: SearchIndex = new Map()
  private combinedIndex: SearchIndex = new Map()
  private readonly build: (entries: T[]) => SearchIndex

  constructor(build: (entries: T[]) => SearchIndex = buildSearchIndex) {
    this.build = build
  }

  get(appEntries: readonly T[], websiteEntries: readonly T[]): SearchIndex {
    let changed = false
    if (!sameSearchData(this.appEntries, appEntries)) {
      this.appEntries = appEntries
      this.appIndex = this.build([...appEntries])
      changed = true
    } else {
      this.appEntries = appEntries
    }
    if (!sameSearchData(this.websiteEntries, websiteEntries)) {
      this.websiteEntries = websiteEntries
      this.websiteIndex = this.build([...websiteEntries])
      changed = true
    } else {
      this.websiteEntries = websiteEntries
    }
    if (changed) this.combinedIndex = new Map([...this.appIndex, ...this.websiteIndex])
    return this.combinedIndex
  }
}
