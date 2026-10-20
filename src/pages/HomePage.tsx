import React, { useContext, useState } from 'react'
import { useNavigate } from '../App'
import { useAccount, useReadContracts } from 'wagmi'
import { NetworkContext } from '../App'
import { NETWORKS } from '../config/networks'
import { VESTING_ABI } from '../lib/abi'
import { formatNativeUsdc, statusFromCode, computeVestedAt, computeClaimable } from '../lib/vesting'
import { StatusBadge } from '../components/StatusBadge'
import { Search, Plus, Clock, TrendingUp, CheckCircle, Undo2 } from 'lucide-react'

interface ScheduleSummary {
  id: bigint
  funder: string
  beneficiary: string
  total: bigint
  claimed: bigint
  refunded: bigint
  start: bigint
  cliff: bigint
  end: bigint
  cancelledAt: bigint
  kind: number
  revocable: boolean
  statusCode: number
}

function ScheduleRow({ s, network, role, nowSec }: { s: ScheduleSummary; network: string; role: 'funding' | 'receiving'; nowSec: number }) {
  const status = statusFromCode(s.statusCode)
  const vested = computeVestedAt(
    { funder: s.funder as `0x${string}`, beneficiary: s.beneficiary as `0x${string}`, total: s.total, claimed: s.claimed, refunded: s.refunded, start: s.start, cliff: s.cliff, end: s.end, cancelledAt: s.cancelledAt, kind: s.kind, revocable: s.revocable },
    [],
    nowSec
  )
  const claimable = computeClaimable(
    { funder: s.funder as `0x${string}`, beneficiary: s.beneficiary as `0x${string}`, total: s.total, claimed: s.claimed, refunded: s.refunded, start: s.start, cliff: s.cliff, end: s.end, cancelledAt: s.cancelledAt, kind: s.kind, revocable: s.revocable },
    [],
    nowSec
  )
  const counterparty = role === 'funding' ? s.beneficiary : s.funder

  return (
    <a
      href={`#/${network}/schedule/${s.id}`}
      className="flex items-center gap-3 p-3 rounded-card border border-border hover:border-brand/30 hover:bg-surface-2 transition-all group cursor-pointer"
    >
      <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0 text-text-muted group-hover:bg-brand-muted group-hover:text-brand transition-colors">
        <span className="font-mono text-xs">#{s.id.toString()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-muted truncate">
            {counterparty.slice(0, 6)}…{counterparty.slice(-4)}
          </span>
          <StatusBadge status={status} />
        </div>
        <div className="text-xs text-text-secondary mt-0.5">
          {formatNativeUsdc(s.total)} USDC total
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs font-mono text-text-primary tabular-nums">
          {formatNativeUsdc(vested, { decimals: 4 })}
        </div>
        <div className="text-[10px] text-text-muted">vested</div>
        {claimable > 0n && (
          <div className="text-[10px] text-success mt-0.5 font-medium">
            {formatNativeUsdc(claimable, { decimals: 4 })} claimable
          </div>
        )}
      </div>
    </a>
  )
}

export function HomePage() {
  const { network } = useContext(NetworkContext)
  const cfg = NETWORKS[network]
  const { address } = useAccount()
  const [lookupId, setLookupId] = useState('')
  const navigate = useNavigate()
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000))

  const contractBase = {
    address: cfg.address,
    abi: VESTING_ABI,
    chainId: cfg.chain.id,
  } as const

  // Fetch ids for connected wallet
  const { data: idsData } = useReadContracts({
    contracts: address
      ? [
          { ...contractBase, functionName: 'idsByFunder', args: [address] },
          { ...contractBase, functionName: 'idsByBeneficiary', args: [address] },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  const fundedIds: bigint[] = (idsData?.[0]?.result as bigint[] | undefined) ?? []
  const beneficiaryIds: bigint[] = (idsData?.[1]?.result as bigint[] | undefined) ?? []

  // Fetch schedules for all ids
  const allIds = [...new Set([...fundedIds, ...beneficiaryIds])]
  const scheduleContracts = allIds.map((id) => ({
    ...contractBase,
    functionName: 'getSchedule' as const,
    args: [id] as const,
  }))
  const statusContracts = allIds.map((id) => ({
    ...contractBase,
    functionName: 'status' as const,
    args: [id] as const,
  }))

  const { data: scheduleData } = useReadContracts({
    contracts: [...scheduleContracts, ...statusContracts],
    query: { enabled: allIds.length > 0, refetchInterval: 15_000 },
  })

  const schedules: ScheduleSummary[] = allIds.map((id, i) => {
    const raw = scheduleData?.[i]?.result as {
      funder: `0x${string}`; beneficiary: `0x${string}`; total: bigint; claimed: bigint
      refunded: bigint; start: bigint; cliff: bigint; end: bigint; cancelledAt: bigint
      kind: number; revocable: boolean
    } | undefined
    const statusCode = scheduleData?.[allIds.length + i]?.result as number | undefined
    return {
      id,
      funder: raw?.funder ?? '0x',
      beneficiary: raw?.beneficiary ?? '0x',
      total: raw?.total ?? 0n,
      claimed: raw?.claimed ?? 0n,
      refunded: raw?.refunded ?? 0n,
      start: raw?.start ?? 0n,
      cliff: raw?.cliff ?? 0n,
      end: raw?.end ?? 0n,
      cancelledAt: raw?.cancelledAt ?? 0n,
      kind: raw?.kind ?? 0,
      revocable: raw?.revocable ?? false,
      statusCode: statusCode ?? 0,
    }
  })

  const funding = schedules.filter((s) => s.funder.toLowerCase() === address?.toLowerCase())
  const receiving = schedules.filter((s) => s.beneficiary.toLowerCase() === address?.toLowerCase())

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault()
    const id = lookupId.trim()
    if (/^[1-9]\d*$/.test(id)) {
      navigate(`/${network}/schedule/${id}`)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero */}
      <div className="text-center pt-4 pb-2">
        <h1 className="font-display font-bold text-3xl tracking-tight text-text-primary mb-2">
          Vesting & Scheduled Payouts
        </h1>
        <p className="text-text-secondary text-sm max-w-md mx-auto text-pretty">
          Deposit once, the clock releases it — USDC vesting on Arc with linear curves or dated tranches.
        </p>
        <a
          href={`#/${network}/new`}
          className="inline-flex items-center gap-2 mt-5 px-5 h-11 rounded-btn bg-brand text-white font-semibold text-sm hover:bg-brand-light transition-colors shadow-brand-glow"
        >
          <Plus size={16} />
          Create a Schedule
        </a>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            icon: <Plus size={18} />,
            title: 'Deposit',
            desc: 'Funder deposits USDC up front and defines a vesting schedule for a beneficiary.',
          },
          {
            icon: <Clock size={18} />,
            title: 'Vests over time',
            desc: 'Linear with optional cliff, or dated tranches. The contract holds custody.',
          },
          {
            icon: <TrendingUp size={18} />,
            title: 'Claim any time',
            desc: 'Anyone can push a payout — funds always go to the beneficiary address.',
          },
          {
            icon: <Undo2 size={18} />,
            title: 'Cancel & recover',
            desc: 'Revocable schedules: funder cancels and gets back only the unvested portion.',
          },
        ].map((step) => (
          <div key={step.title} className="bg-surface rounded-card border border-border p-4 shadow-card">
            <div className="w-8 h-8 rounded-lg bg-brand-muted text-brand flex items-center justify-center mb-3">
              {step.icon}
            </div>
            <div className="font-display font-semibold text-sm text-text-primary mb-1">{step.title}</div>
            <p className="text-text-secondary text-xs text-pretty leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>

      {/* Look up */}
      <div className="bg-surface rounded-card border border-border p-5 shadow-card">
        <h2 className="font-display font-semibold text-sm text-text-primary mb-3">Look up a schedule</h2>
        <form onSubmit={handleLookup} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Schedule ID (e.g. 1)"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-btn bg-surface-3 border border-border text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-brand/50"
            />
          </div>
          <button
            type="submit"
            className="px-4 h-10 rounded-btn bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
          >
            View
          </button>
        </form>
      </div>

      {/* My schedules */}
      {address ? (
        <div className="space-y-5">
          {/* Funding */}
          <div>
            <h2 className="font-display font-semibold text-sm text-text-primary mb-3 flex items-center gap-2">
              Funding
              {funding.length > 0 && (
                <span className="bg-surface-3 text-text-muted text-xs px-2 py-0.5 rounded-chip">
                  {funding.length}
                </span>
              )}
            </h2>
            {funding.length === 0 ? (
              <p className="text-text-muted text-sm">No schedules funded yet.</p>
            ) : (
              <div className="space-y-2">
                {funding.map((s) => (
                  <ScheduleRow key={s.id.toString()} s={s} network={network} role="funding" nowSec={nowSec} />
                ))}
              </div>
            )}
          </div>

          {/* Receiving */}
          <div>
            <h2 className="font-display font-semibold text-sm text-text-primary mb-3 flex items-center gap-2">
              Receiving
              {receiving.length > 0 && (
                <span className="bg-surface-3 text-text-muted text-xs px-2 py-0.5 rounded-chip">
                  {receiving.length}
                </span>
              )}
            </h2>
            {receiving.length === 0 ? (
              <p className="text-text-muted text-sm">No schedules as beneficiary yet.</p>
            ) : (
              <div className="space-y-2">
                {receiving.map((s) => (
                  <ScheduleRow key={s.id.toString()} s={s} network={network} role="receiving" nowSec={nowSec} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-card border border-border p-6 text-center">
          <CheckCircle size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-secondary text-sm">Connect your wallet to see your schedules.</p>
        </div>
      )}
    </div>
  )
}
