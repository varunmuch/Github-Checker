import { uid } from '@/lib/format'
import type { ConnectionStatus } from '@/lib/socket'
import type { ChatItem, Health, PendingAction, Run, ServerEvent, Snapshot } from '@/lib/types'

export interface AppState {
  connection: ConnectionStatus
  health: Health | null
  model: string
  snapshot: Snapshot
  items: ChatItem[]
  run: Run | null
}

export const EMPTY_SNAPSHOT: Snapshot = {
  source: null,
  issues: [],
  fixes: [],
  analysis: null,
  pending: [],
  busy: false,
}

export type Action =
  | { type: 'event'; event: ServerEvent }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'health'; health: Health | null }
  | { type: 'user_message'; text: string }
  | { type: 'local_error'; text: string }
  | { type: 'reset'; snapshot: Snapshot }

const ITEMS_KEY = 'reposcan.items'
const MAX_ITEMS = 200

function loadItems(): ChatItem[] {
  try {
    const raw = sessionStorage.getItem(ITEMS_KEY)
    return raw ? (JSON.parse(raw) as ChatItem[]) : []
  } catch {
    return []
  }
}

export function saveItems(items: ChatItem[]): void {
  try {
    sessionStorage.setItem(ITEMS_KEY, JSON.stringify(items.slice(-MAX_ITEMS)))
  } catch {
    /* storage full or blocked: chat just won't survive a reload */
  }
}

export function initialState(): AppState {
  return {
    connection: 'connecting',
    health: null,
    model: '',
    snapshot: EMPTY_SNAPSHOT,
    items: loadItems(),
    run: null,
  }
}

const now = () => Date.now()

/** Make sure every pending action from the server has a card, and stale cards are closed. */
function syncConfirmCards(items: ChatItem[], pending: PendingAction[]): ChatItem[] {
  const pendingIds = new Set(pending.map(a => a.id))
  const next = items.map(item =>
    item.type === 'confirm' && item.status === 'pending' && !pendingIds.has(item.id)
      ? { ...item, status: 'rejected' as const }
      : item,
  )
  const known = new Set(next.filter(i => i.type === 'confirm').map(i => i.id))
  for (const action of pending) {
    if (!known.has(action.id)) next.push({ type: 'confirm', id: action.id, action, status: 'pending', at: now() })
  }
  return next
}

function handleEvent(state: AppState, event: ServerEvent): AppState {
  switch (event.type) {
    case 'hello':
      return {
        ...state,
        model: event.model,
        snapshot: event.state,
        items: syncConfirmCards(state.items, event.state.pending),
        run: event.state.busy ? (state.run ?? { kind: 'command', label: 'Working', startedAt: now(), tools: [], progress: null }) : null,
      }
    case 'run_started':
      return { ...state, run: { kind: event.kind, label: event.label, startedAt: now(), tools: [], progress: null } }
    case 'tool_call':
      return state.run ? { ...state, run: { ...state.run, tools: [...state.run.tools, event.tool] } } : state
    case 'progress': {
      const { phase, done, total, current } = event
      const run = state.run ?? { kind: 'command' as const, label: 'Working', startedAt: now(), tools: [], progress: null }
      return { ...state, run: { ...run, progress: { phase, done, total, current } } }
    }
    case 'confirm_request':
      if (state.items.some(i => i.id === event.action.id)) return state
      return {
        ...state,
        items: [...state.items, { type: 'confirm', id: event.action.id, action: event.action, status: 'pending', at: now() }],
      }
    case 'action_resolved':
      return {
        ...state,
        items: state.items.map(i =>
          i.type === 'confirm' && i.id === event.action_id
            ? { ...i, status: event.approved ? 'approved' : 'rejected' }
            : i,
        ),
      }
    case 'message': {
      // Approval cards raised during this run read better after the reply that explains them.
      const since = state.run?.startedAt ?? Infinity
      const isNewCard = (i: ChatItem) => i.type === 'confirm' && i.status === 'pending' && i.at >= since
      return {
        ...state,
        items: [
          ...state.items.filter(i => !isNewCard(i)),
          {
            type: 'agent',
            id: uid(),
            text: event.content,
            tools: event.tools,
            label: event.kind === 'chat' ? null : event.label,
            at: now(),
          },
          ...state.items.filter(isNewCard),
        ],
      }
    }
    case 'error':
      return { ...state, items: [...state.items, { type: 'error', id: uid(), text: event.message, at: now() }] }
    case 'interrupted':
      return { ...state, items: [...state.items, { type: 'notice', id: uid(), text: 'Stopped.', at: now() }] }
    case 'run_finished':
      return {
        ...state,
        run: null,
        snapshot: event.state,
        items: syncConfirmCards(state.items, event.state.pending),
      }
    case 'pong':
      return state
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'event':
      return handleEvent(state, action.event)
    case 'connection':
      return { ...state, connection: action.status }
    case 'health':
      return { ...state, health: action.health }
    case 'user_message':
      return { ...state, items: [...state.items, { type: 'user', id: uid(), text: action.text, at: now() }] }
    case 'local_error':
      return { ...state, items: [...state.items, { type: 'error', id: uid(), text: action.text, at: now() }] }
    case 'reset':
      return { ...state, snapshot: action.snapshot, items: [], run: null }
  }
}
