/** Backend address. In dev the API runs on :8000; in production it serves this page. */
export const API_URL: string = (
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : window.location.origin)
).replace(/\/$/, '')

export const API_TOKEN: string = import.meta.env.VITE_API_TOKEN ?? ''

export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'

const SESSION_KEY = 'reposcan.session'

/** One session per browser tab (sessionStorage), kept across reloads. */
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}
