# USDC Vesting

**by Swift Bot Labs**

> Vesting and scheduled payouts in USDC on Arc: deposit once, the clock releases it.

A non-custodial USDC vesting app built on Arc. Create linear vesting schedules (with optional cliff) or dated tranche payouts. The smart contract holds custody; anyone can trigger a payout, but funds always go to the registered beneficiary.

---

## What it does

- **Linear vesting** — deposit USDC, set start/cliff/end, the contract releases it proportionally by the second.
- **Tranche payouts** — define up to 100 dated payouts; each becomes claimable at its timestamp.
- **Claim** — anyone can call `claim(id)`; funds always go to the beneficiary.
- **Cancel** — revocable schedules only: funder cancels and receives back only the unvested portion; the vested portion stays claimable by the beneficiary.
- **Timeline** — all `ScheduleCreated`, `Claimed`, `Cancelled` events are fetched on-demand from the chain.

## Rules

- All amounts are 18-decimal native USDC (Arc's `msg.value`). The 6-decimal ERC-20 at `0x3600...` is not used.
- `maxFeePerGas` is set to at least 20 gwei (Arc mempool floor).
- No external oracles, no admins, no upgrade proxies.
- Non-revocable schedules cannot be cancelled under any circumstances.
- A beneficiary that cannot receive native USDC (e.g. a contract that rejects plain transfers) will see `TransferFailed` on claim. The vested amount remains locked; a funder with a revocable schedule can cancel to recover the unvested part.

## Deployed contracts

| Chain | Address | Explorer |
|---|---|---|
| Arc Mainnet | `0x89137144644a6538948484d23de7ed313c8f2717` | [explorer.arc.io](https://explorer.arc.io/address/0x89137144644a6538948484d23de7ed313c8f2717) |
| Arc Testnet | `0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32` | [explorer.testnet.arc.io](https://explorer.testnet.arc.io/address/0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32) |

Both use identical bytecode.

## Run locally

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
bun run build
```

Output goes to `dist/`. The app is configured for sub-path serving (`base: './'`) and uses hash routing, so it works from any path (e.g. `swiftbotlab.github.io/usdc-vesting/`).

## Stack

- React 18 + Vite + TypeScript
- wagmi v2 + viem + ConnectKit (injected wallet only)
- Tailwind CSS (dark fintech, red brand accent)
- No external RPC proxies — uses Arc's public RPC endpoints directly

## Limitations

- No beneficiary change after creation.
- No arbiter or dispute resolution.
- All schedule data is public on-chain.
- A contract beneficiary that cannot receive native USDC cannot be paid (see above).
- Timeline scan starts from the deployment block; very long histories may take a few seconds.
