import React, { useContext, useState, useEffect, useCallback, useRef, type MutableRefObject } from 'react'
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { createPublicClient, http, parseGwei, decodeEventLog, keccak256, toBytes } from 'viem'
import { toast } from 'sonner'
import { NetworkContext } from '../App'
import { NETWORKS } from '../config/networks'
import { VESTING_ABI } from '../lib/abi'
import {
  formatNativeUsdc, exactNativeUsdc, formatTs, statusFromCode,
  computeVestedAt, decodeContractError,
  type RawTranche,
} from '../lib/vesting'
import { StatusBadge } from '../components/StatusBadge'
import { VestingChart } from '../components/VestingChart'
import { ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react'

const MIN_GAS_PRICE = parseGwei('20')
const CHUNK = 9_000n

// Precompute topic0 for each event so we can dispatch by topic0 rather than trying all 3
const TOPIC0: Record<string, 'ScheduleCreated' | 'Claimed' | 'Cancelled' | 'TrancheAdded'> = {
  [keccak256(toBytes('ScheduleCreated(uint256,address,address,uint8,uint128,uint64,uint64,uint64,bool)'))]: 'ScheduleCreated',
  [keccak256(toBytes('Claimed(uint256,address,uint256,uint256,address)'))]: 'Claimed',
  [keccak256(toBytes('Cancelled(uint256,address,address,uint256,uint256)'))]: 'Cancelled',
  [keccak256(toBytes('TrancheAdded(uint256,uint256,uint64,uint128)'))]: 'TrancheAdded',
}

interface TimelineEvent {
  type: 'ScheduleCreated' | 'Claimed' | 'Cancelled' | 'TrancheAdded'
  txHash: string
  logIndex: number
  blockNumber: bigint
  blockTime?: number // unix seconds, set from getBlock when available
  args: Record<string, unknown>
}

// All hooks live at top level. Early returns happen after all hooks are called.
export function SchedulePage({ id }: { id: string }) {
  const { network } = useContext(NetworkContext)
  const cfg = NETWORKS[network]
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const isValidId = /^[1-9]\d*$/.test(id)
  const scheduleId = isValidId ? BigInt(id) : 0n

  const contractBase = {
    address: cfg.address,
    abi: VESTING_ABI,
    chainId: cfg.chain.id,
  } as const

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { ...contractBase, functionName: 'scheduleCount' },
      { ...contractBase, functionName: 'getSchedule', args: [scheduleId] },
      { ...contractBase, functionName: 'getTranches', args: [scheduleId] },
      { ...contractBase, functionName: 'claimable', args: [scheduleId] },
      { ...contractBase, functionName: 'status', args: [scheduleId] },
    ],
    query: { enabled: isValidId, refetchInterval: 15_000 },
  })

  // Live clock
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  // Timeline state — single dispatch to avoid set-state-in-effect per state var
  type TLState = { events: TimelineEvent[]; loading: boolean; error: boolean }
  type TLAction =
    | { type: 'start' }
    | { type: 'done'; events: TimelineEvent[] }
    | { type: 'fail' }
  const [tlState, dispatchTl] = React.useReducer(
    (_s: TLState, a: TLAction): TLState => {
      if (a.type === 'start') return { events: [], loading: true, error: false }
      if (a.type === 'done') return { events: a.events, loading: false, error: false }
      return { events: [], loading: false, error: true }
    },
    { events: [], loading: false, error: false }
  )
  const timeline = tlState.events
  const timelineLoading = tlState.loading
  const timelineError = tlState.error

  // Pure fetch — returns data, never touches state
  const doFetchTimeline = useCallback(async (): Promise<{ events: TimelineEvent[]; error: boolean }> => {
    if (!isValidId) return { events: [], error: false }
    try {
      const client = createPublicClient({
        chain: cfg.chain,
        transport: http(cfg.chain.rpcUrls.default.http[0]),
      })
      const head = await client.getBlockNumber()
      const fromBlock = cfg.deploymentBlock
      const rawEvents: TimelineEvent[] = []
      const seen = new Set<string>()

      for (let from = fromBlock; from <= head; from += CHUNK) {
        const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n
        const logs = await client.getLogs({
          address: cfg.address,
          fromBlock: from,
          toBlock: to,
        })
        for (const log of logs) {
          const topic0 = log.topics[0]
          if (!topic0) continue
          const eventName = TOPIC0[topic0]
          if (!eventName) continue
          // Decode by the correct event name only
          try {
            const dec = decodeEventLog({ abi: VESTING_ABI, data: log.data, topics: log.topics, eventName })
            if (!dec?.args) continue
            const args = dec.args as Record<string, unknown>
            if (args['id'] !== scheduleId) continue
            // Deduplicate by txHash+logIndex
            const key = `${log.transactionHash ?? ''}-${log.logIndex ?? 0}`
            if (seen.has(key)) continue
            seen.add(key)
            rawEvents.push({
              type: eventName,
              txHash: log.transactionHash ?? '',
              logIndex: log.logIndex ?? 0,
              blockNumber: log.blockNumber ?? 0n,
              args,
            })
          } catch {
            // malformed log — skip
          }
        }
      }

      // Sort by block then logIndex
      rawEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
        return a.logIndex - b.logIndex
      })

      // Fetch block timestamps in a single multicall batch for unique blocks
      const uniqueBlocks = [...new Set(rawEvents.map((e) => e.blockNumber))]
      const blockTimes = new Map<bigint, number>()
      try {
        await Promise.all(
          uniqueBlocks.map(async (bn) => {
            const blk = await client.getBlock({ blockNumber: bn })
            blockTimes.set(bn, Number(blk.timestamp))
          })
        )
      } catch {
        // timestamps are best-effort
      }
      const events = rawEvents.map((e) => ({
        ...e,
        blockTime: blockTimes.get(e.blockNumber),
      }))

      // Group consecutive TrancheAdded events into a single synthetic entry
      const collapsed: TimelineEvent[] = []
      for (let i = 0; i < events.length; i++) {
        if (events[i].type === 'TrancheAdded') {
          let count = 1
          while (i + count < events.length && events[i + count].type === 'TrancheAdded') count++
          collapsed.push({
            type: 'TrancheAdded',
            txHash: events[i].txHash,
            logIndex: events[i].logIndex,
            blockNumber: events[i].blockNumber,
            blockTime: events[i].blockTime,
            args: { count },
          })
          i += count - 1
        } else {
          collapsed.push(events[i])
        }
      }

      return { events: collapsed, error: false }
    } catch {
      return { events: [], error: true }
    }
  }, [cfg, scheduleId, isValidId])

  // Trigger load; single dispatch for each outcome
  const fetchTimeline = useCallback(() => {
    dispatchTl({ type: 'start' })
    doFetchTimeline().then(({ events, error }) => {
      if (error) dispatchTl({ type: 'fail' })
      else dispatchTl({ type: 'done', events })
    }).catch(() => {
      dispatchTl({ type: 'fail' })
    })
  }, [doFetchTimeline])

  useEffect(fetchTimeline, [fetchTimeline])

  // Tx hooks
  const { writeContractAsync, isPending } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // useRef so updating inside an effect doesn't trigger set-state-in-effect
  const pendingToastRef = useRef<string | number | undefined>(undefined)

  // Dismiss confirming toast once receipt lands, then refresh data
  const { isSuccess: receiptSuccess } = useWaitForTransactionReceipt({ hash: txHash })
  useEffect(() => {
    if (!receiptSuccess || !txHash) return
    if (pendingToastRef.current !== undefined) toast.dismiss(pendingToastRef.current)
    pendingToastRef.current = undefined
    void refetch()
    void fetchTimeline()
  }, [receiptSuccess, txHash]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaim = useCallback(async () => {
    if (!address || !isValidId) return
    if (chainId !== cfg.chain.id) { switchChain({ chainId: cfg.chain.id }); return }
    const tid = toast.loading('Waiting for wallet...')
    try {
      const hash = await writeContractAsync({
        address: cfg.address, abi: VESTING_ABI, functionName: 'claim',
        args: [scheduleId],
        maxFeePerGas: MIN_GAS_PRICE, maxPriorityFeePerGas: MIN_GAS_PRICE,
      })
      setTxHash(hash)
      const confirmId = toast.loading('Confirming on-chain…', {
        action: { label: 'Explorer', onClick: () => window.open(`${cfg.explorerBase}/tx/${hash}`, '_blank') },
      })
      toast.dismiss(tid)
      pendingToastRef.current = confirmId
    } catch (err) {
      const msg = decodeContractError(err)
      if (!msg.includes('cancelled')) toast.error(msg, { id: tid })
      else toast.dismiss(tid)
    }
  }, [address, chainId, cfg, scheduleId, isValidId, writeContractAsync, switchChain, pendingToastRef])

  const handleCancel = useCallback(async () => {
    if (!address || !isValidId) return
    if (chainId !== cfg.chain.id) { switchChain({ chainId: cfg.chain.id }); return }
    const tid = toast.loading('Waiting for wallet...')
    setShowCancelConfirm(false)
    try {
      const hash = await writeContractAsync({
        address: cfg.address, abi: VESTING_ABI, functionName: 'cancel',
        args: [scheduleId],
        maxFeePerGas: MIN_GAS_PRICE, maxPriorityFeePerGas: MIN_GAS_PRICE,
      })
      setTxHash(hash)
      const confirmId = toast.loading('Confirming on-chain…', {
        action: { label: 'Explorer', onClick: () => window.open(`${cfg.explorerBase}/tx/${hash}`, '_blank') },
      })
      toast.dismiss(tid)
      pendingToastRef.current = confirmId
    } catch (err) {
      const msg = decodeContractError(err)
      if (!msg.includes('cancelled')) toast.error(msg, { id: tid })
      else toast.dismiss(tid)
    }
  }, [address, chainId, cfg, scheduleId, isValidId, writeContractAsync, switchChain, pendingToastRef])

  // ─── Early returns (after all hooks) ─────────────────────────────────────
  if (!isValidId) {
    return <NotFound msg="Invalid schedule ID." />
  }

  const scheduleCount = (data?.[0]?.result) ?? 0n
  const rawSchedule = data?.[1]?.result
  const rawTranches = (data?.[2]?.result as RawTranche[] | undefined) ?? []
  const onChainClaimable = (data?.[3]?.result) ?? 0n
  const statusCode = (data?.[4]?.result) ?? 0

  if (!isLoading && scheduleCount > 0n && scheduleId > scheduleCount) {
    return <NotFound msg={`Schedule #${id} does not exist. Only ${scheduleCount} schedules have been created.`} />
  }
  if (!isLoading && scheduleCount === 0n && scheduleId >= 1n) {
    return <NotFound msg="No schedules have been created yet." />
  }

  const vested = rawSchedule ? computeVestedAt(rawSchedule, rawTranches, nowSec) : 0n
  const claimedMarkers = timeline
    .filter((e) => e.type === 'Claimed')
    .map((e) => e.blockTime ?? 0)
    .filter((t) => t > 0)

  const isSubmitting = isPending || isConfirming
  const status = statusFromCode(statusCode)
  const isFunder = rawSchedule && address?.toLowerCase() === rawSchedule.funder.toLowerCase()
  const canCancel = isFunder && rawSchedule?.revocable && status === 'Active'
  const unvested = rawSchedule ? rawSchedule.total - vested : 0n

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-text-muted text-sm animate-pulse">
        Loading schedule #{id}…
      </div>
    )
  }

  if (!rawSchedule) {
    return <NotFound msg={`Schedule #${id} not found.`} />
  }

  const s = rawSchedule
  const kindLabel = s.kind === 0 ? 'Linear' : 'Tranches'

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-display font-bold text-2xl tracking-tight text-text-primary">
              Schedule #{id}
            </h1>
            <StatusBadge status={status} />
            <span className="text-xs text-text-muted border border-border px-2 py-0.5 rounded-chip">{kindLabel}</span>
            {s.revocable && <span className="text-xs text-warning border border-warning/30 px-2 py-0.5 rounded-chip">Revocable</span>}
          </div>
        </div>
        <button
          onClick={() => { void refetch(); void fetchTimeline() }}
          className="w-9 h-9 flex items-center justify-center rounded-btn text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <RefreshCw size={15} className={timelineLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Big vested number */}
      <div className="bg-surface rounded-card border border-border p-5 shadow-card">
        <div className="text-xs text-text-muted uppercase tracking-wider mb-1" style={{ letterSpacing: '0.08em' }}>Vested so far</div>
        <div className="font-display font-bold text-4xl tracking-tight text-text-primary tabular-nums">
          {formatNativeUsdc(vested, { decimals: 6 })}
        </div>
        <div className="text-text-muted text-sm mt-0.5">USDC out of {formatNativeUsdc(s.total)} total</div>

        <div className="mt-4 h-2 rounded-full bg-surface-3 overflow-hidden">
          <div
            className="h-full rounded-full bg-brand transition-all duration-1000"
            style={{ width: `${s.total > 0n ? Math.min(100, Number((vested * 10000n) / s.total) / 100) : 0}%` }}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Claimed" value={formatNativeUsdc(s.claimed)} title={exactNativeUsdc(s.claimed)} />
          <Stat label="Claimable" value={formatNativeUsdc(onChainClaimable)} accent={onChainClaimable > 0n} title={exactNativeUsdc(onChainClaimable)} />
          <Stat label="Total" value={formatNativeUsdc(s.total)} title={exactNativeUsdc(s.total)} />
          <Stat label="Refunded" value={formatNativeUsdc(s.refunded)} title={exactNativeUsdc(s.refunded)} />
        </div>
      </div>

      {/* Chart */}
      <div className="bg-surface rounded-card border border-border p-4 shadow-card">
        <div className="text-xs text-text-muted mb-3 uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>Vesting curve</div>
        <VestingChart schedule={s} tranches={rawTranches} nowSec={nowSec} claimedMarkers={claimedMarkers} height={130} />
      </div>

      {/* Addresses */}
      <div className="bg-surface rounded-card border border-border p-4 shadow-card space-y-3">
        <AddrRow label="Funder" addr={s.funder} explorerBase={cfg.explorerBase} />
        <div className="h-px bg-border" />
        <AddrRow label="Beneficiary" addr={s.beneficiary} explorerBase={cfg.explorerBase} />
      </div>

      {/* Schedule details */}
      <div className="bg-surface rounded-card border border-border p-4 shadow-card">
        <div className="text-xs text-text-muted mb-3 uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>Schedule details</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <Detail label="Start" value={formatTs(Number(s.start))} />
          {s.kind === 0 && <Detail label="Cliff" value={formatTs(Number(s.cliff))} />}
          <Detail label="End" value={s.kind === 0
            ? formatTs(Number(s.end))
            : formatTs(Number(rawTranches[rawTranches.length - 1]?.time ?? s.end))} />
          {s.cancelledAt > 0n && <Detail label="Cancelled at" value={formatTs(Number(s.cancelledAt))} accent="error" />}
        </div>
      </div>

      {/* Tranche table */}
      {s.kind === 1 && rawTranches.length > 0 && (
        <div className="bg-surface rounded-card border border-border p-4 shadow-card">
          <div className="text-xs text-text-muted mb-3 uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>Tranches</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rawTranches.map((t, i) => {
                  // Cumulative claimed up to and including this tranche
                  let cumulative = 0n
                  for (let j = 0; j <= i; j++) cumulative += rawTranches[j].amount
                  const trancheTime = Number(t.time)
                  const isCancelledAfter = s.cancelledAt > 0n && t.time > s.cancelledAt
                  let trancheStatus: 'Paid' | 'Claimable' | 'Pending' | 'Cancelled'
                  if (isCancelledAfter) {
                    trancheStatus = 'Cancelled'
                  } else if (trancheTime <= nowSec) {
                    trancheStatus = cumulative <= s.claimed ? 'Paid' : 'Claimable'
                  } else {
                    trancheStatus = 'Pending'
                  }
                  const statusColors: Record<typeof trancheStatus, string> = {
                    Paid: 'bg-surface-3 text-text-muted',
                    Claimable: 'bg-success-muted text-success',
                    Pending: 'bg-surface-3 text-text-muted',
                    Cancelled: 'bg-error-muted text-error',
                  }
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-2 text-text-muted font-mono">{i + 1}</td>
                      <td className="py-2 text-text-secondary text-xs">{formatTs(trancheTime)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatNativeUsdc(t.amount)}</td>
                      <td className="py-2 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-chip ${statusColors[trancheStatus]}`}>
                          {trancheStatus}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {onChainClaimable > 0n && (
          <button
            onClick={() => { void handleClaim() }}
            disabled={isSubmitting}
            className="w-full h-12 rounded-btn bg-brand text-white font-semibold text-sm hover:bg-brand-light transition-colors disabled:opacity-50 shadow-brand-glow"
          >
            {isSubmitting ? 'Confirming...' : `Claim ${formatNativeUsdc(onChainClaimable)} USDC`}
          </button>
        )}

        {canCancel && !showCancelConfirm && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="w-full h-11 rounded-btn border border-error/40 text-error text-sm font-medium hover:bg-error-muted transition-colors"
          >
            Cancel schedule
          </button>
        )}

        {showCancelConfirm && (
          <div className="bg-error-muted border border-error/30 rounded-card p-4 space-y-3">
            <div className="text-sm text-text-primary font-medium">Confirm cancellation</div>
            <p className="text-text-secondary text-xs leading-relaxed">
              You get back{' '}
              <span className="text-text-primary font-semibold">{formatNativeUsdc(unvested)} USDC</span>
              {' '}(not vested yet).{' '}
              The beneficiary keeps{' '}
              <span className="text-text-primary font-semibold">{formatNativeUsdc(vested)} USDC</span>:{' '}
              {formatNativeUsdc(s.claimed)} already claimed,{' '}
              {formatNativeUsdc(vested > s.claimed ? vested - s.claimed : 0n)} still claimable any time.
            </p>
            <div className="flex gap-2">
              <button onClick={() => { void handleCancel() }} disabled={isSubmitting}
                className="flex-1 h-10 rounded-btn bg-error text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                {isSubmitting ? 'Confirming...' : 'Yes, cancel'}
              </button>
              <button onClick={() => setShowCancelConfirm(false)}
                className="flex-1 h-10 rounded-btn border border-border text-text-secondary text-sm hover:text-text-primary transition-colors">
                Keep active
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-surface rounded-card border border-border p-4 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-text-muted uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>Timeline</div>
          {timelineError && (
            <span className="flex items-center gap-1 text-warning text-xs">
              <AlertTriangle size={11} /> Incomplete
              <button onClick={() => { void fetchTimeline() }} className="underline ml-1">Retry</button>
            </span>
          )}
        </div>
        {timelineLoading ? (
          <div className="text-text-muted text-xs py-3 animate-pulse">Scanning events…</div>
        ) : timeline.length === 0 ? (
          <div className="text-text-muted text-xs py-2">No events found yet.</div>
        ) : (
          <div className="space-y-2">
            {timeline.map((ev, i) => {
              const dotColor = ev.type === 'Claimed' ? 'bg-success' : ev.type === 'Cancelled' ? 'bg-error' : ev.type === 'TrancheAdded' ? 'bg-brand/50' : 'bg-brand'
              const timeStr = ev.blockTime ? formatTs(ev.blockTime) : `block ${ev.blockNumber.toString()}`
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    {ev.type === 'ScheduleCreated' && (() => {
                      const a = ev.args as { kind?: number; total?: bigint }
                      return (
                        <>
                          <div className="text-xs text-text-primary font-medium">
                            Schedule created — {a.kind === 0 ? 'Linear' : 'Tranches'},{' '}
                            {formatNativeUsdc(a.total ?? 0n)} USDC
                          </div>
                          <div className="text-[10px] text-text-muted">{timeStr}</div>
                        </>
                      )
                    })()}
                    {ev.type === 'TrancheAdded' && (() => {
                      const a = ev.args as { count?: number }
                      return (
                        <>
                          <div className="text-xs text-text-primary font-medium">
                            {a.count ?? 1} tranche{(a.count ?? 1) !== 1 ? 's' : ''} added
                          </div>
                          <div className="text-[10px] text-text-muted">{timeStr}</div>
                        </>
                      )
                    })()}
                    {ev.type === 'Claimed' && (() => {
                      const a = ev.args as { amount?: bigint; caller?: string; beneficiary?: string }
                      const pushedBy = a.caller && a.beneficiary &&
                        a.caller.toLowerCase() !== a.beneficiary.toLowerCase()
                      return (
                        <>
                          <div className="text-xs text-text-primary font-medium">
                            Claimed {formatNativeUsdc(a.amount ?? 0n)} USDC
                            {pushedBy && (
                              <span className="text-text-muted font-normal">
                                {' '}— pushed by <span className="font-mono">{String(a.caller).slice(0, 6)}…{String(a.caller).slice(-4)}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-text-muted">{timeStr}</div>
                        </>
                      )
                    })()}
                    {ev.type === 'Cancelled' && (() => {
                      const a = ev.args as { vestedAmount?: bigint; refunded?: bigint }
                      return (
                        <>
                          <div className="text-xs text-text-primary font-medium">
                            Cancelled — {formatNativeUsdc(a.vestedAmount ?? 0n)} USDC vested kept,{' '}
                            {formatNativeUsdc(a.refunded ?? 0n)} refunded to funder
                          </div>
                          <div className="text-[10px] text-text-muted">{timeStr}</div>
                        </>
                      )
                    })()}
                    <a
                      href={`${cfg.explorerBase}/tx/${ev.txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-text-muted hover:text-brand transition-colors flex items-center gap-0.5 mt-0.5"
                    >
                      {ev.txHash.slice(0, 10)}…{ev.txHash.slice(-6)} <ExternalLink size={9} />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {timelineError && !timelineLoading && (
          <p className="text-xs text-text-muted mt-2">Timeline may be incomplete. Some events could not be loaded.</p>
        )}
      </div>
    </div>
  )
}

function NotFound({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center text-text-muted">
        <AlertTriangle size={22} />
      </div>
      <div className="font-display font-semibold text-text-primary">Schedule not found</div>
      <p className="text-text-secondary text-sm max-w-xs">{msg}</p>
      <a href="#/" className="mt-2 text-brand text-sm hover:underline">Back to home</a>
    </div>
  )
}

function Stat({ label, value, accent, title }: { label: string; value: string; accent?: boolean; title?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-text-muted uppercase" style={{ letterSpacing: '0.06em' }}>{label}</div>
      <div
        title={title}
        className={`font-mono tabular-nums text-sm ${accent ? 'text-success font-semibold' : 'text-text-primary'} ${title ? 'cursor-help' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}

function Detail({ label, value, accent }: { label: string; value: string; accent?: 'error' }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted text-xs">{label}</span>
      <span className={`text-xs font-mono text-right ${accent === 'error' ? 'text-error' : 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

function AddrRow({ label, addr, explorerBase }: { label: string; addr: string; explorerBase: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-text-muted">{label}</span>
      <a
        href={`${explorerBase}/address/${addr}`}
        target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 font-mono text-xs text-text-primary hover:text-brand transition-colors"
      >
        {addr.slice(0, 6)}…{addr.slice(-4)}
        <ExternalLink size={11} />
      </a>
    </div>
  )
}
