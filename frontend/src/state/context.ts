import { createContext, useContext } from 'react'
import type { Command } from '@/lib/types'
import type { AppState } from './reducer'

export interface AppActions {
  sendChat: (text: string) => void
  runCommand: (command: Command) => void
  confirm: (actionId: string, approved: boolean) => void
  interrupt: () => void
  newSession: () => Promise<void>
  refreshHealth: () => void
}

export const AppContext = createContext<{ state: AppState; actions: AppActions } | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
