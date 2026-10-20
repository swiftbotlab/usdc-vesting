import React, { useContext } from 'react'
import { ConnectKitButton } from 'connectkit'
import { NetworkContext } from '../App'
import { NETWORKS } from '../config/networks'
import { ExternalLink, TestTube2 } from 'lucide-react'

export function Layout({ children }: { children: React.ReactNode }) {
  const { network, setNetwork } = useContext(NetworkContext)
  const cfg = NETWORKS[network]
  const isTestnet = network === 'testnet'

  return (
    <div className="min-h-dvh bg-canvas font-body text-text-primary flex flex-col">
      {/* Testnet banner */}
      {isTestnet && (
        <div className="bg-warning/10 border-b border-warning/20 px-4 py-2 text-center sticky top-0 z-50">
          <span className="flex items-center justify-center gap-1.5 text-warning text-xs font-medium">
            <TestTube2 size={13} />
            Arc Testnet: test USDC only — no real value
          </span>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-canvas/90 backdrop-blur z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="#/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center shadow-brand-glow flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 12V4l5-3 5 3v8l-5 2-5-2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M7 13V7M2 4l5 3 5-3" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div className="font-display font-semibold text-sm text-text-primary tracking-tight leading-none">
                USDC Vesting
              </div>
              <div className="text-text-muted text-[10px] leading-none mt-0.5">Swift Bot Labs</div>
            </div>
          </a>

          <div className="flex items-center gap-2">
            {/* Network toggle */}
            <button
              onClick={() => setNetwork(isTestnet ? 'mainnet' : 'testnet')}
              className="hidden sm:flex items-center gap-1.5 px-3 h-8 rounded-chip border border-border text-text-secondary text-xs hover:border-brand/50 hover:text-brand transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isTestnet ? 'bg-warning' : 'bg-success'}`} />
              {cfg.label}
            </button>

            {/* New schedule */}
            <a
              href={`#/${network}/new`}
              className="hidden sm:flex items-center px-3 h-8 rounded-btn bg-brand text-white text-xs font-semibold hover:bg-brand-light transition-colors"
            >
              + New Schedule
            </a>

            <ConnectKitButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-5">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-text-muted text-xs">
          <span>Swift Bot Labs — USDC Vesting</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isTestnet ? 'bg-warning' : 'bg-success'}`} />
              {cfg.label}
            </span>
            <a
              href={`${cfg.explorerBase}/address/${cfg.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-text-secondary transition-colors"
            >
              Contract <ExternalLink size={11} />
            </a>
            <button
              onClick={() => setNetwork(isTestnet ? 'mainnet' : 'testnet')}
              className="sm:hidden hover:text-text-secondary transition-colors"
            >
              Switch to {isTestnet ? 'Mainnet' : 'Testnet'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
