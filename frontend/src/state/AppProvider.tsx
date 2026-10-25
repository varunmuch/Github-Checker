import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { AgentSocket } from '@/lib/socket'
import type { Command } from '@/lib/types'
import { AppContext, type AppActions } from './context'
import { initialState, reducer, saveItems } from './reducer'

const HEALTH_POLL_MS = 15_000

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const socketRef = useRef<AgentSocket | null>(null)

  useEffect(() => {
    const socket = new AgentSocket({
      onEvent: event => dispatch({ type: 'event', event }),
      onStatus: status => dispatch({ type: 'connection', status }),
    })
    socketRef.current = socket
    socket.connect()
    return () => socket.close()
  }, [])

  useEffect(() => saveItems(state.items), [state.items])

  const refreshHealth = useCallback(() => {
    api.health()
      .then(health => dispatch({ type: 'health', health }))
      .catch(() => dispatch({ type: 'health', health: null }))
  }, [])

  // Re-check the model while it's unavailable, so the banner clears on its own.
  const modelOk = state.health?.ollama.ok ?? false
  useEffect(() => {
    refreshHealth()
    if (modelOk && state.connection === 'open') return
    const timer = setInterval(refreshHealth, HEALTH_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshHealth, modelOk, state.connection])

  const send = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current?.send(payload)) return true
    toast.error('Not connected to the backend. Retrying…')
    return false
  }, [])

  const actions = useMemo<AppActions>(() => ({
    sendChat: text => {
      if (send({ type: 'chat', message: text })) dispatch({ type: 'user_message', text })
    },
    runCommand: (command: Command) => {
      send({ type: 'command', ...command })
    },
    confirm: (actionId, approved) => {
      send({ type: 'confirm', action_id: actionId, approved })
    },
    interrupt: () => {
      send({ type: 'interrupt' })
    },
    newSession: async () => {
      try {
        const snapshot = await api.reset()
        dispatch({ type: 'reset', snapshot })
        toast.success('Started a new session')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not reset the session')
      }
    },
    refreshHealth,
  }), [send, refreshHealth])

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
