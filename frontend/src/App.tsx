import { useState } from 'react'
import { Toaster } from 'sonner'
import { AppProvider } from '@/state/AppProvider'
import { useApp } from '@/state/context'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { TopBar, type Tab } from '@/components/layout/TopBar'
import { HealthBanner } from '@/components/layout/HealthBanner'
import { ChatView } from '@/components/chat/ChatView'
import { IssuesView } from '@/components/issues/IssuesView'
import { FixesView } from '@/components/fixes/FixesView'

function Shell() {
  const [tab, setTab] = useState<Tab>('chat')
  const [panelOpen, setPanelOpen] = useState(false)
  const { state } = useApp()
  const showChat = () => { setTab('chat'); setPanelOpen(false) }
  // The chat's welcome screen has its own source form; don't show two.
  const heroVisible = tab === 'chat' && !state.snapshot.source && state.items.length === 0 && !state.run

  return (
    <div className="flex h-full overflow-hidden bg-bg text-fg">
      <Sidebar open={panelOpen} onClose={() => setPanelOpen(false)} onAction={showChat} heroVisible={heroVisible} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar tab={tab} onTab={setTab} onMenu={() => setPanelOpen(true)} />
        <HealthBanner />
        {tab === 'chat' && <ChatView />}
        {tab === 'issues' && <IssuesView onAction={showChat} />}
        {tab === 'fixes' && <FixesView />}
      </main>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: 'var(--elev)', border: '1px solid var(--border)', color: 'var(--fg)' },
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
