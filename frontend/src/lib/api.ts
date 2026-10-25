import { API_TOKEN, API_URL, getSessionId } from './config'
import type { Health, Snapshot } from './types'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Session-ID': getSessionId() }
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<Health>('/api/health'),
  state: () => request<Snapshot>('/api/state'),
  reset: () => request<Snapshot>('/api/state', { method: 'DELETE' }),
}
