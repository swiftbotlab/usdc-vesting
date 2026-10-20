import React, { useContext, useState, useRef, type MutableRefObject } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { parseGwei, decodeEventLog } from 'viem'
import { toast } from 'sonner'
import { NetworkContext, useNavigate } from '../App'
import { NETWORKS } from '../config/networks'
import { VESTING_ABI } from '../lib/abi'
import {
  formatNativeUsdc, parseNativeUsdc, validateLinear, validateTranches,
  decodeContractError, type TrancheRow,
} from '../lib/vesting'
import { VestingChart } from '../components/VestingChart'
import { Plus, Trash2, Zap, CalendarDays } from 'lucide-react'

const MIN_GAS_PRICE = parseGwei('20')

// step="1" keeps seconds; the value must include :ss for browsers that support it
function toDatetimeLocal(sec: number): string {
  const d = new Date(sec * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fromDatetimeLocal(s: string): number {
  if (!s) return 0
  return Math.floor(new Date(s).getTime() / 1000)
}

export function NewSchedulePage() {
  const { network } = useContext(NetworkContext)
  const cfg = NETWORKS[network]
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const navigate = useNavigate()

  const [tab, setTab] = useState<'linear' | 'tranches'>('linear')

  // ─── Linear state ──────────────────────────────────────────────────────────
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [linBeneficiary, setLinBeneficiary] = useState('')
  const [linAmount, setLinAmount] = useState('')
  const [linStart, setLinStart] = useState(toDatetimeLocal(nowSec))
  const [linCliff, setLinCliff] = useState(toDatetimeLocal(nowSec))
  const [linEnd, setLinEnd] = useState(toDatetimeLocal(nowSec + 86400 * 365))
  const [linRevocable, setLinRevocable] = useState(true)

  // Touch tracking for validation errors (#13)
  const [linTouched, setLinTouched] = useState<Record<string, boolean>>({})
  const [linSubmitAttempted, setLinSubmitAttempted] = useState(false)

  // ─── Tranches state ─────────────────────────────────────────────────────────
  const [trBeneficiary, setTrBeneficiary] = useState('')
  const [trTotal, setTrTotal] = useState('')
  const [trRevocable, setTrRevocable] = useState(true)
  const [trRows, setTrRows] = useState<TrancheRow[]>([
    { time: nowSec + 86400 * 30, amount: '' },
    { time: nowSec + 86400 * 60, amount: '' },
  ])
  // Track whether tranche row amounts were manually edited (so auto-fill doesn't override)
  const trManualEdits = useRef<Set<number>>(new Set())
  const [trTouched, setTrTouched] = useState<Record<string, boolean>>({})
  const [trSubmitAttempted, setTrSubmitAttempted] = useState(false)

  // ─── Tx hooks ──────────────────────────────────────────────────────────────
  const { writeContractAsync, isPending } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  // useRef so that updating it inside an effect doesn't trigger set-state-in-effect
  const pendingToastRef = useRef<string | number | undefined>(undefined)
  const { isLoading: isConfirming, data: receipt } = useWaitForTransactionReceipt({ hash: txHash })

  // ─── Navigate to new schedule once receipt lands (#14 — dismiss toast) ─────
  React.useEffect(() => {
    if (!receipt || !txHash) return
    // Dismiss any lingering confirming toast
    if (pendingToastRef.current !== undefined) toast.dismiss(pendingToastRef.current)
    pendingToastRef.current = undefined
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: VESTING_ABI,
          data: log.data,
          topics: log.topics,
          eventName: 'ScheduleCreated',
        })
        if (decoded?.args) {
          const id = (decoded.args as { id: bigint }).id
          const nav = navigate
          const net = network
          toast.success(`Schedule #${id} created!`, {
            action: {
              label: 'View',
              onClick: () => nav(`/${net}/schedule/${id}`),
            },
          })
          navigate(`/${network}/schedule/${id}`)
          return
        }
      } catch {
        // not this log
      }
    }
    toast.success('Schedule created!')
    navigate(`/${network}/`)
  }, [receipt, txHash, navigate, network]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Linear validation ─────────────────────────────────────────────────────
  const linStartSec = fromDatetimeLocal(linStart)
  const linCliffSec = fromDatetimeLocal(linCliff)
  const linEndSec = fromDatetimeLocal(linEnd)
  const linTotalRaw = parseNativeUsdc(linAmount)
  const linVal = validateLinear(linBeneficiary, linTotalRaw, linStartSec, linCliffSec, linEndSec, nowSec)

  // ─── Tranches validation ───────────────────────────────────────────────────
  const trVal = validateTranches(trBeneficiary, trTotal, trRows, nowSec)

  // ─── Preview schedules for chart ───────────────────────────────────────────
  const linPreview = {
    funder: '0x' as `0x${string}`,
    beneficiary: '0x' as `0x${string}`,
    total: linTotalRaw ?? 0n,
    claimed: 0n as bigint, refunded: 0n as bigint,
    start: BigInt(linStartSec), cliff: BigInt(linCliffSec), end: BigInt(linEndSec),
    cancelledAt: 0n as bigint, kind: 0, revocable: linRevocable,
  }

  const trFirstTime = trRows.length > 0 ? trRows[0].time : 0
  const trLastTime = trRows.length > 0 ? trRows[trRows.length - 1].time : 0
  const trPreview = trRows.length > 0 ? {
    funder: '0x' as `0x${string}`,
    beneficiary: '0x' as `0x${string}`,
    total: trVal.totalRaw,
    claimed: 0n as bigint, refunded: 0n as bigint,
    start: BigInt(trFirstTime), cliff: BigInt(trFirstTime), end: BigInt(trLastTime),
    cancelledAt: 0n as bigint, kind: 1, revocable: trRevocable,
  } : null

  const trPreviewTranches = trRows.map((r, i) => ({ time: BigInt(r.time), amount: trVal.parsedAmounts[i] ?? 0n }))

  // ─── Presets ───────────────────────────────────────────────────────────────
  const applyLinPreset = (preset: '3min' | '4yr') => {
    if (preset === '3min') {
      setLinStart(toDatetimeLocal(nowSec))
      setLinCliff(toDatetimeLocal(nowSec + 30))
      setLinEnd(toDatetimeLocal(nowSec + 180))
    } else {
      setLinStart(toDatetimeLocal(nowSec))
      setLinCliff(toDatetimeLocal(nowSec + 86400 * 365))
      setLinEnd(toDatetimeLocal(nowSec + 86400 * 365 * 4))
    }
  }

  // Auto-distribute tranche amounts evenly when total is set and rows have no manual edits
  function distributeAmounts(rows: TrancheRow[], totalInput: string, manualEdits: Set<number>): TrancheRow[] {
    const totalRaw = parseNativeUsdc(totalInput)
    if (!totalRaw || totalRaw <= 0n || rows.length === 0) return rows
    // Only auto-fill rows that haven't been manually edited
    const unmanaged = rows.map((_, i) => i).filter((i) => !manualEdits.has(i))
    if (unmanaged.length === 0) return rows
    const managedSum = rows.reduce((s, r, i) => manualEdits.has(i) ? s + (parseNativeUsdc(r.amount) ?? 0n) : s, 0n)
    const remainder = totalRaw > managedSum ? totalRaw - managedSum : 0n
    if (remainder <= 0n) return rows
    const perRow = remainder / BigInt(unmanaged.length)
    const extra = remainder - perRow * BigInt(unmanaged.length)
    return rows.map((r, i) => {
      if (!unmanaged.includes(i)) return r
      const isLast = i === unmanaged[unmanaged.length - 1]
      const amt = isLast ? perRow + extra : perRow
      return { ...r, amount: amt > 0n ? formatNativeUsdc(amt, { decimals: 6 }) : '' }
    })
  }

  const applyTrPreset = (preset: 'weekly4' | 'onepayout') => {
    trManualEdits.current = new Set()
    const totalRaw = parseNativeUsdc(trTotal)
    if (preset === 'weekly4') {
      const baseRows: TrancheRow[] = [
        { time: nowSec + 86400 * 7, amount: '' },
        { time: nowSec + 86400 * 14, amount: '' },
        { time: nowSec + 86400 * 21, amount: '' },
        { time: nowSec + 86400 * 28, amount: '' },
      ]
      const filled = totalRaw && totalRaw > 0n ? distributeAmounts(baseRows, trTotal, new Set()) : baseRows
      setTrRows(filled)
    } else {
      const baseRows: TrancheRow[] = [{ time: nowSec + 86400 * 30, amount: '' }]
      const filled = totalRaw && totalRaw > 0n ? distributeAmounts(baseRows, trTotal, new Set()) : baseRows
      setTrRows(filled)
    }
  }

  // When trTotal changes, re-distribute amounts in non-manually-edited rows
  const handleTrTotalChange = (val: string) => {
    setTrTotal(val)
    setTrRows((rows) => distributeAmounts(rows, val, trManualEdits.current))
    setTrTouched((t) => ({ ...t, trTotal: true }))
  }

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!address) return
    const wrongChain = chainId !== cfg.chain.id
    if (wrongChain) {
      switchChain({ chainId: cfg.chain.id })
      return
    }

    if (tab === 'linear') {
      setLinSubmitAttempted(true)
      if (!linVal.valid) return
    } else {
      setTrSubmitAttempted(true)
      if (!trVal.valid) return
    }

    const toastId = toast.loading('Waiting for wallet confirmation...')
    try {
      let hash: `0x${string}`
      if (tab === 'linear') {
        hash = await writeContractAsync({
          address: cfg.address,
          abi: VESTING_ABI,
          functionName: 'createLinear',
          args: [
            linBeneficiary as `0x${string}`,
            BigInt(linStartSec),
            BigInt(linCliffSec),
            BigInt(linEndSec),
            linRevocable,
          ],
          value: linTotalRaw!,
          maxFeePerGas: MIN_GAS_PRICE,
          maxPriorityFeePerGas: MIN_GAS_PRICE,
        })
      } else {
        hash = await writeContractAsync({
          address: cfg.address,
          abi: VESTING_ABI,
          functionName: 'createTranches',
          args: [
            trBeneficiary as `0x${string}`,
            trRows.map((r) => BigInt(r.time)),
            trVal.parsedAmounts,
            trRevocable,
          ],
          value: trVal.totalRaw,
          maxFeePerGas: MIN_GAS_PRICE,
          maxPriorityFeePerGas: MIN_GAS_PRICE,
        })
      }
      setTxHash(hash)
      // Show confirming toast; dismiss on receipt in the useEffect above
      const confirmId = toast.loading('Confirming on-chain…', {
        action: { label: 'Explorer', onClick: () => window.open(`${cfg.explorerBase}/tx/${hash}`, '_blank') },
      })
      toast.dismiss(toastId)
      pendingToastRef.current = confirmId
    } catch (err) {
      const msg = decodeContractError(err)
      if (!msg.includes('cancelled')) {
        toast.error(msg, { id: toastId })
      } else {
        toast.dismiss(toastId)
      }
    }
  }

  const isSubmitting = isPending || isConfirming
  const canSubmitLinear = linVal.valid && !!address && !isSubmitting
  const canSubmitTranches = trVal.valid && !!address && !isSubmitting

  // ─── Tranche row helpers ────────────────────────────────────────────────────
  const addTrRow = () => {
    const last = trRows[trRows.length - 1]
    const newRows = [...trRows, { time: last ? last.time + 86400 * 7 : nowSec + 86400 * 7, amount: '' }]
    setTrRows(distributeAmounts(newRows, trTotal, trManualEdits.current))
  }
  const removeTrRow = (i: number) => {
    trManualEdits.current.delete(i)
    // Re-index manual edits above the removed index
    const newEdits = new Set<number>()
    trManualEdits.current.forEach((idx) => { if (idx < i) newEdits.add(idx); else if (idx > i) newEdits.add(idx - 1) })
    trManualEdits.current = newEdits
    const newRows = trRows.filter((_, idx) => idx !== i)
    setTrRows(distributeAmounts(newRows, trTotal, trManualEdits.current))
  }
  const updateTrRow = (i: number, field: keyof TrancheRow, value: string | number) => {
    if (field === 'amount') {
      trManualEdits.current = new Set([...trManualEdits.current, i])
    }
    setTrRows(trRows.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
    setTrTouched((t) => ({ ...t, [`row${i}`]: true }))
  }

  const wrongChain = address && chainId !== cfg.chain.id

  // Determine which errors to show: only after touch or submit attempt
  const showLinErrors = linSubmitAttempted || Object.keys(linTouched).length > 0
  const showTrErrors = trSubmitAttempted || Object.keys(trTouched).length > 0

  return (
    <div className="max-w-xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="font-display font-bold text-2xl tracking-tight text-text-primary">New Schedule</h1>
        <p className="text-text-secondary text-sm mt-1">Create a vesting or payout schedule funded by native USDC.</p>
      </div>

      {/* Wrong chain warning */}
      {wrongChain && (
        <div className="bg-warning-muted border border-warning/30 rounded-card p-3 text-warning text-sm flex items-center gap-2">
          <span>Switch to {cfg.label} to create a schedule.</span>
          <button
            onClick={() => switchChain({ chainId: cfg.chain.id })}
            className="ml-auto px-3 h-7 rounded-btn bg-warning text-canvas text-xs font-semibold"
          >
            Switch
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-2 rounded-btn p-1 border border-border">
        {(['linear', 'tranches'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-8 rounded-[7px] text-sm font-medium transition-colors capitalize ${
              tab === t
                ? 'bg-brand text-white shadow'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Linear form ────────────────────────────────────────────────────── */}
      {tab === 'linear' && (
        <div className="space-y-4">
          {/* Presets */}
          <div className="flex gap-2">
            <button
              onClick={() => applyLinPreset('3min')}
              className="flex items-center gap-1.5 px-3 h-8 rounded-chip border border-border text-text-secondary text-xs hover:border-brand/40 hover:text-brand transition-colors"
            >
              <Zap size={11} /> 3-min test
            </button>
            <button
              onClick={() => applyLinPreset('4yr')}
              className="flex items-center gap-1.5 px-3 h-8 rounded-chip border border-border text-text-secondary text-xs hover:border-brand/40 hover:text-brand transition-colors"
            >
              <CalendarDays size={11} /> 4 yr, 1 yr cliff
            </button>
          </div>

          <Field label="Beneficiary address">
            <input
              type="text"
              placeholder="0x..."
              value={linBeneficiary}
              onChange={(e) => setLinBeneficiary(e.target.value)}
              onBlur={() => setLinTouched((t) => ({ ...t, beneficiary: true }))}
              className="w-full h-10 px-3 rounded-btn bg-surface-3 border border-border text-text-primary text-sm font-mono placeholder:text-text-muted focus:outline-none focus:border-brand/50"
            />
          </Field>

          <Field label="Total amount (USDC)">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.000000"
                value={linAmount}
                onChange={(e) => setLinAmount(e.target.value)}
                onBlur={() => setLinTouched((t) => ({ ...t, amount: true }))}
                className="w-full h-10 px-3 pr-14 rounded-btn bg-surface-3 border border-border text-text-primary text-sm tabular-nums placeholder:text-text-muted focus:outline-none focus:border-brand/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs font-medium">USDC</span>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Start">
              <input type="datetime-local" step="1" value={linStart}
                onChange={(e) => setLinStart(e.target.value)}
                onBlur={() => setLinTouched((t) => ({ ...t, start: true }))}
                className="w-full h-10 px-2 rounded-btn bg-surface-3 border border-border text-text-primary text-xs focus:outline-none focus:border-brand/50" />
            </Field>
            <Field label="Cliff (optional)">
              <input type="datetime-local" step="1" value={linCliff}
                onChange={(e) => setLinCliff(e.target.value)}
                onBlur={() => setLinTouched((t) => ({ ...t, cliff: true }))}
                className="w-full h-10 px-2 rounded-btn bg-surface-3 border border-border text-text-primary text-xs focus:outline-none focus:border-brand/50" />
            </Field>
            <Field label="End">
              <input type="datetime-local" step="1" value={linEnd}
                onChange={(e) => setLinEnd(e.target.value)}
                onBlur={() => setLinTouched((t) => ({ ...t, end: true }))}
                className="w-full h-10 px-2 rounded-btn bg-surface-3 border border-border text-text-primary text-xs focus:outline-none focus:border-brand/50" />
            </Field>
          </div>

          <Field label="">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={linRevocable}
                onChange={(e) => setLinRevocable(e.target.checked)}
                className="w-4 h-4 accent-brand rounded"
              />
              <span className="text-sm text-text-secondary">Revocable (funder can cancel)</span>
            </label>
          </Field>

          {/* Preview chart */}
          {linTotalRaw !== null && linTotalRaw > 0n && linEndSec > linStartSec && (
            <div className="bg-surface rounded-card border border-border p-4">
              <div className="text-xs text-text-muted mb-2">Vesting curve preview</div>
              <VestingChart schedule={linPreview} tranches={[]} nowSec={nowSec} height={100} />
            </div>
          )}

          {/* Validation errors — shown only after touch or submit attempt */}
          {showLinErrors && linVal.errors.length > 0 && (
            <ul className="space-y-1">
              {linVal.errors.map((e) => (
                <li key={e} className="text-error text-xs">{e}</li>
              ))}
            </ul>
          )}

          <SubmitButton
            label="Create Linear Schedule"
            disabled={!canSubmitLinear}
            loading={isSubmitting}
            notConnected={!address}
            onClick={() => { void handleSubmit() }}
          />
        </div>
      )}

      {/* ── Tranches form ────────────────────────────────────────────────── */}
      {tab === 'tranches' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => applyTrPreset('weekly4')}
              className="flex items-center gap-1.5 px-3 h-8 rounded-chip border border-border text-text-secondary text-xs hover:border-brand/40 hover:text-brand transition-colors">
              <Zap size={11} /> Weekly ×4
            </button>
            <button onClick={() => applyTrPreset('onepayout')}
              className="flex items-center gap-1.5 px-3 h-8 rounded-chip border border-border text-text-secondary text-xs hover:border-brand/40 hover:text-brand transition-colors">
              <CalendarDays size={11} /> One payout
            </button>
          </div>

          <Field label="Beneficiary address">
            <input type="text" placeholder="0x..." value={trBeneficiary}
              onChange={(e) => setTrBeneficiary(e.target.value)}
              onBlur={() => setTrTouched((t) => ({ ...t, beneficiary: true }))}
              className="w-full h-10 px-3 rounded-btn bg-surface-3 border border-border text-text-primary text-sm font-mono placeholder:text-text-muted focus:outline-none focus:border-brand/50" />
          </Field>

          <Field label="Total amount (USDC)">
            <div className="relative">
              <input type="number" min="0" step="any" placeholder="0.000000" value={trTotal}
                onChange={(e) => handleTrTotalChange(e.target.value)}
                onBlur={() => setTrTouched((t) => ({ ...t, trTotal: true }))}
                className="w-full h-10 px-3 pr-14 rounded-btn bg-surface-3 border border-border text-text-primary text-sm tabular-nums placeholder:text-text-muted focus:outline-none focus:border-brand/50" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs font-medium">USDC</span>
            </div>
          </Field>

          {/* Tranche rows */}
          <div className="space-y-2">
            <div className="text-xs text-text-muted flex justify-between">
              <span>Tranches ({trRows.length}/{100})</span>
              {trVal.totalRaw > 0n && (
                <span className={trVal.valid ? 'text-success' : 'text-warning'}>
                  Sum: {formatNativeUsdc(trVal.parsedAmounts.reduce((a, b) => a + b, 0n))} / {trTotal} USDC
                </span>
              )}
            </div>
            {trRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="datetime-local"
                  step="1"
                  value={toDatetimeLocal(row.time)}
                  onChange={(e) => updateTrRow(i, 'time', fromDatetimeLocal(e.target.value))}
                  className="flex-1 h-9 px-2 rounded-btn bg-surface-3 border border-border text-text-primary text-xs focus:outline-none focus:border-brand/50"
                />
                <input
                  type="number" min="0" step="any" placeholder="Amount"
                  value={row.amount}
                  onChange={(e) => updateTrRow(i, 'amount', e.target.value)}
                  onBlur={() => setTrTouched((t) => ({ ...t, [`row${i}`]: true }))}
                  className="w-28 h-9 px-2 rounded-btn bg-surface-3 border border-border text-text-primary text-xs tabular-nums placeholder:text-text-muted focus:outline-none focus:border-brand/50"
                />
                <button onClick={() => removeTrRow(i)} disabled={trRows.length <= 1}
                  className="w-9 h-9 flex items-center justify-center rounded-btn text-text-muted hover:text-error hover:bg-error-muted transition-colors disabled:opacity-30">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button onClick={addTrRow} disabled={trRows.length >= 100}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-brand transition-colors py-1 disabled:opacity-40">
              <Plus size={13} /> Add tranche
            </button>
          </div>

          <Field label="">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={trRevocable} onChange={(e) => setTrRevocable(e.target.checked)}
                className="w-4 h-4 accent-brand rounded" />
              <span className="text-sm text-text-secondary">Revocable (funder can cancel)</span>
            </label>
          </Field>

          {/* Preview chart */}
          {trPreview && trVal.totalRaw > 0n && (
            <div className="bg-surface rounded-card border border-border p-4">
              <div className="text-xs text-text-muted mb-2">Payout curve preview</div>
              <VestingChart schedule={trPreview} tranches={trPreviewTranches} nowSec={nowSec} height={100} />
            </div>
          )}

          {/* Validation errors — shown only after touch or submit attempt */}
          {showTrErrors && trVal.errors.length > 0 && (
            <ul className="space-y-1">
              {trVal.errors.map((e) => (
                <li key={e} className="text-error text-xs">{e}</li>
              ))}
            </ul>
          )}

          <SubmitButton
            label="Create Tranche Schedule"
            disabled={!canSubmitTranches}
            loading={isSubmitting}
            notConnected={!address}
            onClick={() => { void handleSubmit() }}
          />
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-medium text-text-secondary tracking-wide uppercase" style={{ letterSpacing: '0.06em' }}>{label}</label>}
      {children}
    </div>
  )
}

function SubmitButton({ label, disabled, loading, notConnected, onClick }: {
  label: string; disabled: boolean; loading: boolean; notConnected: boolean; onClick: () => void
}) {
  if (notConnected) {
    return (
      <div className="bg-surface-2 rounded-card border border-border p-4 text-center text-text-secondary text-sm">
        Connect your wallet to create a schedule.
      </div>
    )
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-12 rounded-btn bg-brand text-white font-semibold text-sm hover:bg-brand-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-brand-glow"
    >
      {loading ? 'Confirming...' : label}
    </button>
  )
}
