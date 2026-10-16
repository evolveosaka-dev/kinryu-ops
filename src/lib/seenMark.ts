// The last id a notice on ホーム was opened at, per key (this phone only). Never throws: storage may be blocked.

export function readSeen(key: string): number {
  try {
    return Number(localStorage.getItem(`seen:${key}`) ?? 0) || 0
  } catch {
    return 0
  }
}

export function writeSeen(key: string, id: number) {
  try {
    localStorage.setItem(`seen:${key}`, String(id))
  } catch {
    // ignore
  }
}
