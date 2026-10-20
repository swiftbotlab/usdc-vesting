/**
 * Vesting utilities: formatting, local vesting formula, error decoding.
 * All amounts are 18-decimal native USDC (Arc msg.value).
 */

import { formatEther, parseEther } from 'viem'

// ─── Amount Formatting ────────────────────────────────────────────────────────

/** Format 18-decimal bigint as USDC string. Shows 6 decimals with half-up rounding; more when very small. */
export function formatNativeUsdc(raw: bigint, opts?: { decimals?: number }): string {
  const d = opts?.decimals ?? 6
  // Use BigInt arithmetic for half-up rounding at d decimal places
  // 1 ether = 10^18; we want d decimal places so shift = 10^(18-d)
  const shift = 10n ** BigInt(18 - d)
  const half = shift / 2n
  const rounded = (raw + half) / shift  // integer with d decimal places of precision
  const s = rounded.toString()
  // s is in units of 10^(-d), so last d digits are the fractional part
  const padded = s.padStart(d + 1, '0')
  const intPart = padded.slice(0, padded.length - d) || '0'
  const fracPart = padded.slice(padded.length - d)
  // If rounded gives 0 but raw > 0, show more precision (very small values)
  if (intPart === '0' && fracPart === '0'.repeat(d) && raw > 0n) {
    const full = formatEther(raw)
    const [, f2 = ''] = full.split('.')
    const nonZeroIdx = f2.split('').findIndex((c) => c !== '0')
    if (nonZeroIdx >= d) {
      return `0.${f2.slice(0, nonZeroIdx + 4)}`
    }
  }
  return `${intPart}.${fracPart}`
}

/** Exact display value for use in title="" tooltips (never truncated). */
export function exactNativeUsdc(raw: bigint): string {
  return formatEther(raw)
}

/** Parse human-readable USDC string to 18-decimal bigint. Returns null on invalid. */
export function parseNativeUsdc(s: string): bigint | null {
  try {
    const trimmed = s.trim()
    if (!trimmed || trimmed === '.') return null
    return parseEther(trimmed)
  } catch {
    return null
  }
}

export function shortAddr(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  })
}

export function formatTsDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

// ─── Schedule Type ────────────────────────────────────────────────────────────

export interface RawSchedule {
  funder: `0x${string}`
  beneficiary: `0x${string}`
  total: bigint
  claimed: bigint
  refunded: bigint
  start: bigint
  cliff: bigint
  end: bigint
  cancelledAt: bigint
  kind: number
  revocable: boolean
}

export interface RawTranche {
  time: bigint
  amount: bigint
}

export type ScheduleStatus = 'None' | 'Active' | 'Completed' | 'Cancelled'

export function statusFromCode(code: number): ScheduleStatus {
  switch (code) {
    case 1: return 'Active'
    case 2: return 'Completed'
    case 3: return 'Cancelled'
    default: return 'None'
  }
}

// ─── Local Vesting Formula ────────────────────────────────────────────────────
// Mirrors the Solidity vestedAt() exactly (integer floor division).

export function computeVestedAt(s: RawSchedule, tranches: RawTranche[], atSec: number): bigint {
  const at = BigInt(atSec)

  // Apply cancelledAt freeze
  let effective = at
  if (s.cancelledAt !== 0n && effective > s.cancelledAt) {
    effective = s.cancelledAt
  }

  if (s.kind === 0) {
    // Linear
    if (effective < s.cliff) return 0n
    if (effective >= s.end) return s.total
    return (s.total * (effective - s.start)) / (s.end - s.start)
  } else {
    // Tranches
    let sum = 0n
    for (const t of tranches) {
      if (t.time <= effective) sum += t.amount
    }
    return sum
  }
}

export function computeClaimable(s: RawSchedule, tranches: RawTranche[], atSec: number): bigint {
  const vested = computeVestedAt(s, tranches, atSec)
  if (vested <= s.claimed) return 0n
  return vested - s.claimed
}

// ─── Validation ───────────────────────────────────────────────────────────────

export const MAX_TRANCHES = 100
export const MAX_DURATION_SECS = 3650 * 24 * 3600

export interface LinearValidation {
  valid: boolean
  errors: string[]
}

export function validateLinear(
  beneficiary: string,
  totalRaw: bigint | null,
  startSec: number,
  cliffSec: number,
  endSec: number,
  nowSec: number,
): LinearValidation {
  const errors: string[] = []
  if (!beneficiary || !/^0x[0-9a-fA-F]{40}$/.test(beneficiary)) {
    errors.push('Invalid beneficiary address')
  }
  if (!totalRaw || totalRaw <= 0n) errors.push('Amount must be > 0')
  if (totalRaw && totalRaw > 2n ** 128n - 1n) errors.push('Amount too large')
  if (startSec >= endSec) errors.push('Start must be before end')
  if (startSec > cliffSec) errors.push('Cliff must be >= start')
  if (cliffSec > endSec) errors.push('Cliff must be <= end')
  if (endSec <= nowSec) errors.push('End must be in the future')
  if (endSec - startSec > MAX_DURATION_SECS) errors.push('Duration exceeds 10 years')
  return { valid: errors.length === 0, errors }
}

export interface TrancheRow {
  time: number // unix seconds
  amount: string // human readable
}

export interface TranchesValidation {
  valid: boolean
  errors: string[]
  totalRaw: bigint
  parsedAmounts: bigint[]
}

export function validateTranches(
  beneficiary: string,
  totalInput: string,
  rows: TrancheRow[],
  nowSec: number,
): TranchesValidation {
  const errors: string[] = []
  if (!beneficiary || !/^0x[0-9a-fA-F]{40}$/.test(beneficiary)) {
    errors.push('Invalid beneficiary address')
  }
  if (rows.length === 0) errors.push('At least one tranche required')
  if (rows.length > MAX_TRANCHES) errors.push(`Max ${MAX_TRANCHES} tranches`)

  const parsedAmounts: bigint[] = []
  let sum = 0n
  for (let i = 0; i < rows.length; i++) {
    const p = parseNativeUsdc(rows[i].amount)
    if (!p || p <= 0n) {
      errors.push(`Tranche ${i + 1}: invalid amount`)
      parsedAmounts.push(0n)
    } else {
      parsedAmounts.push(p)
      sum += p
    }
    if (i > 0 && rows[i].time <= rows[i - 1].time) {
      errors.push(`Tranche ${i + 1}: time must be after tranche ${i}`)
    }
  }

  const totalRaw = parseNativeUsdc(totalInput) ?? 0n
  if (totalRaw <= 0n) errors.push('Total amount must be > 0')

  if (errors.length === 0 && sum !== totalRaw) {
    errors.push(`Tranche amounts sum to ${formatNativeUsdc(sum)} but total is ${totalInput}`)
  }

  if (rows.length > 0) {
    const last = rows[rows.length - 1].time
    if (last <= nowSec) errors.push('Last tranche must be in the future')
    if (rows.length > 1) {
      const first = rows[0].time
      if (last - first > MAX_DURATION_SECS) errors.push('Duration exceeds 10 years')
    }
  }

  return { valid: errors.length === 0, errors, totalRaw, parsedAmounts }
}

// ─── Custom Error Decoder ─────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  NothingToClaim: 'Nothing has vested yet — check back later.',
  NothingToReclaim: 'Schedule is fully vested — nothing to refund.',
  NotFunder: 'Only the original funder can cancel this schedule.',
  NotRevocable: 'This schedule cannot be cancelled (non-revocable).',
  AlreadyCancelled: 'This schedule has already been cancelled.',
  UnknownSchedule: 'Schedule not found.',
  ZeroAmount: 'Amount must be greater than zero.',
  AmountTooLarge: 'Amount exceeds the maximum (uint128).',
  ZeroAddress: 'Beneficiary address cannot be zero.',
  SelfSchedule: 'You cannot create a schedule for yourself.',
  InvalidSchedule: 'Schedule parameters are invalid.',
  TransferFailed: 'Transfer failed — the recipient may not accept native USDC.',
  ReentrancyGuardReentrantCall: 'Reentrant call detected.',
}

export function decodeContractError(err: unknown): string {
  if (!err) return 'Unknown error'
  const raw = (err as { message?: string })?.message
  const msg = (raw !== undefined ? raw : JSON.stringify(err) ?? '').toLowerCase()

  if (msg.includes('user rejected') || msg.includes('user denied')) {
    return 'Transaction cancelled.'
  }
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
    return 'Insufficient balance.'
  }

  for (const [name, friendly] of Object.entries(ERROR_MESSAGES)) {
    if (msg.includes(name.toLowerCase()) || msg.includes(name)) {
      return friendly
    }
  }

  if (msg.includes('reverted')) {
    return 'Transaction reverted — check your inputs and try again.'
  }
  if (msg.includes('timeout') || msg.includes('network')) {
    return 'Network error — check your connection and retry.'
  }

  return 'Transaction failed. Please try again.'
}

// ─── SVG Chart Helpers ────────────────────────────────────────────────────────

export interface ChartPoint {
  x: number // 0..1 normalized time
  y: number // 0..1 normalized amount
}

/** Build chart path points for a linear schedule */
export function linearChartPoints(
  start: number,
  cliff: number,
  end: number,
): ChartPoint[] {
  const duration = end - start
  if (duration <= 0) return []
  const norm = (t: number) => (t - start) / duration
  const pts: ChartPoint[] = [
    { x: 0, y: 0 },
  ]
  if (cliff > start) {
    pts.push({ x: norm(cliff), y: 0 })
    pts.push({ x: norm(cliff), y: norm(cliff) })
  }
  pts.push({ x: 1, y: 1 })
  return pts
}

/** Build chart path points for tranches */
export function tranchesChartPoints(
  tranches: Array<{ time: number; amount: bigint }>,
  total: bigint,
): ChartPoint[] {
  if (!tranches.length || total === 0n) return []
  const start = tranches[0].time
  const end = tranches[tranches.length - 1].time
  const duration = end - start
  if (duration <= 0) return []

  const pts: ChartPoint[] = [{ x: 0, y: 0 }]
  let cumulative = 0n
  for (const t of tranches) {
    const xBefore = (t.time - start) / duration
    pts.push({ x: xBefore, y: Number(cumulative) / Number(total) })
    cumulative += t.amount
    pts.push({ x: xBefore, y: Number(cumulative) / Number(total) })
  }
  return pts
}
