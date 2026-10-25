import { API_TOKEN, WS_URL, getSessionId } from './config'
import type { ServerEvent } from './types'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

interface Handlers {
  onEvent: (event: ServerEvent) => void
  onStatus: (status: ConnectionStatus) => void
}

/** WebSocket with automatic reconnect (exponential backoff, capped at 10s). */
export class AgentSocket {
  private ws: WebSocket | null = null
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private handlers: Handlers

  constructor(handlers: Handlers) {
    this.handlers = handlers
  }

  connect(): void {
    this.stopped = false
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    const params = new URLSearchParams({ session: getSessionId() })
    if (API_TOKEN) params.set('token', API_TOKEN)

    this.handlers.onStatus('connecting')
    const ws = new WebSocket(`${WS_URL}?${params}`)
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      this.handlers.onStatus('open')
      this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 25_000)
    }
    ws.onmessage = (ev) => {
      try {
        this.handlers.onEvent(JSON.parse(ev.data as string) as ServerEvent)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.ws = null
      this.handlers.onStatus('closed')
      if (this.stopped) return
      const delay = Math.min(10_000, 500 * 2 ** this.retry++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }

  send(payload: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(payload))
    return true
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }
}
