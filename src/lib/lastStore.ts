// Staff work at both stores, so there is no "home store": forms start with the store chosen last time.
const KEY = 'kinryu.lastStore'

export function getLastStore(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastStore(storeId: string): void {
  try {
    localStorage.setItem(KEY, storeId)
  } catch {
    // storage unavailable: the first store is used next time
  }
}

/** The remembered store if it still exists, otherwise the first store. */
export function initialStore(storeIds: readonly string[]): string {
  const last = getLastStore()
  return last && storeIds.includes(last) ? last : (storeIds[0] ?? '')
}
