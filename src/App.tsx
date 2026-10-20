import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { NewSchedulePage } from './pages/NewSchedulePage'
import { SchedulePage } from './pages/SchedulePage'
import {
  NETWORKS,
  DEFAULT_NETWORK,
  setNetworkInStorage,
  type NetworkKey,
} from './config/networks'

// ─── Network Context ──────────────────────────────────────────────────────────

interface NetworkContextType {
  network: NetworkKey
  setNetwork: (n: NetworkKey) => void
}

export const NetworkContext = createContext<NetworkContextType>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
})

// ─── Navigation helper ────────────────────────────────────────────────────────

const NavContext = createContext<(path: string) => void>(() => {})

export function useNavigate() {
  return useContext(NavContext)
}

// ─── Hash Router ──────────────────────────────────────────────────────────────

function parseHash(hash: string): { network: NetworkKey; page: string; param?: string } {
  // hash: #/<network>/<page>/<param> or #/<network>/<page>
  const clean = hash.replace(/^#/, '').replace(/^\//, '')
  const parts = clean.split('/')
  const networkRaw = parts[0]
  const network: NetworkKey =
    networkRaw === 'testnet' ? 'testnet' : networkRaw === 'mainnet' ? 'mainnet' : DEFAULT_NETWORK
  const page = parts[1] ?? ''
  const param = parts[2]
  return { network, page, param }
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

interface EBState { hasError: boolean; message: string }

class ErrorBoundary extends React.Component<
  { children: ReactNode },
  EBState
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }
  static getDerivedStateFromError(err: unknown): EBState {
    return { hasError: true, message: String((err as Error)?.message ?? err) }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-canvas flex items-center justify-center p-6">
          <div className="bg-surface border border-border rounded-card p-6 max-w-sm w-full text-center space-y-3">
            <div className="font-display font-bold text-text-primary">Something went wrong</div>
            <p className="text-text-secondary text-sm break-words">{this.state.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false, message: '' }); window.location.hash = '/' }}
              className="px-4 h-9 rounded-btn bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
            >
              Go home
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Frame Guard (allow only within studio.arc.io) ────────────────────────────

function isBlockedByFramePolicy(): boolean {
  if (window.self === window.top) return false
  const origins = window.location.ancestorOrigins
  if (!origins) return false // not available — allow
  for (let i = 0; i < origins.length; i++) {
    if (!origins[i].startsWith('https://studio.arc.io')) return true
  }
  return false
}

function FrameGuard({ children }: { children: ReactNode }) {
  // Synchronous check at render time — ancestorOrigins is always available
  const blocked = isBlockedByFramePolicy()

  if (blocked) {
    return (
      <div className="min-h-dvh bg-canvas flex items-center justify-center p-6">
        <div className="bg-surface border border-border rounded-card p-6 max-w-xs w-full text-center space-y-3">
          <div className="font-display font-bold text-text-primary">Open USDC Vesting in its own tab</div>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 h-10 rounded-btn bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors leading-10"
          >
            Open app
          </a>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [hash, setHash] = useState(window.location.hash || '#/')

  // Keep hash in sync (external system sync — no setState cascade)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Derive network from current hash (pure render-time derivation, no setState)
  const routeParsed = parseHash(hash)
  const routeNetwork = routeParsed.network

  // Persist to localStorage whenever routeNetwork changes (non-setState effect)
  useEffect(() => {
    setNetworkInStorage(routeNetwork)
  }, [routeNetwork])

  const setNetwork = useCallback((n: NetworkKey) => {
    setNetworkInStorage(n)
    // Redirect to home of new network — hash update will re-derive routeNetwork
    window.location.hash = `/${n}/`
  }, [])

  const navigate = useCallback((path: string) => {
    window.location.hash = path
  }, [])

  const { page, param } = routeParsed
  const network = routeNetwork

  const renderPage = () => {
    switch (page) {
      case 'new':
        return <NewSchedulePage />
      case 'schedule':
        if (param) return <SchedulePage id={param} />
        return <HomePage />
      default:
        return <HomePage />
    }
  }

  const cfg = NETWORKS[network]

  return (
    <ErrorBoundary>
      <FrameGuard>
        <NetworkContext.Provider value={{ network, setNetwork }}>
          <NavContext.Provider value={navigate}>
            {!cfg.address ? (
              <Layout>
                <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
                  <div className="font-display font-bold text-text-primary">Not deployed yet</div>
                  <p className="text-text-secondary text-sm">
                    UsdcVesting has not been deployed to {cfg.label}.
                  </p>
                </div>
              </Layout>
            ) : (
              <Layout>{renderPage()}</Layout>
            )}
          </NavContext.Provider>
        </NetworkContext.Provider>
      </FrameGuard>
    </ErrorBoundary>
  )
}
