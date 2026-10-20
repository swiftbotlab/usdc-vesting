# USDC Vesting

**by Swift Bot Labs**

> Vesting and scheduled payouts in USDC on Arc: deposit once, the clock releases it.

A non-custodial USDC vesting app built on Arc. Create linear vesting schedules (with optional cliff) or dated tranche payouts. The smart contract holds custody; anyone can trigger a payout, but funds always go to the registered beneficiary.

Live app: **https://swiftbotlab.github.io/usdc-vesting/**

---

## What it does

- **Linear vesting** — deposit USDC, set start/cliff/end, the contract releases it proportionally by the second.
- **Tranche payouts** — define up to 100 dated payouts; each becomes claimable at its timestamp.
- **Claim** — anyone can call `claim(id)`; funds always go to the beneficiary.
- **Cancel** — revocable schedules only: funder cancels and receives back only the unvested portion; the vested portion stays claimable by the beneficiary.
- **Timeline** — `ScheduleCreated`, `TrancheAdded`, `Claimed`, `Cancelled` events fetched on-demand in 9,000-block chunks from the deployment block.

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

## Live on Arc mainnet

Deployment: block 26872860, source verified, byte-identical to the testnet deployment.

| # | Event | Tx hash | Explorer |
|---|---|---|---|
| — | **Deploy** | `0x4cc755b8cdc41cedd700eeb69507526991a7a18b5bece37b1c85b78ad5775f15` | [view](https://explorer.arc.io/tx/0x4cc755b8cdc41cedd700eeb69507526991a7a18b5bece37b1c85b78ad5775f15) |
| 1 | Create (linear 0.06 USDC) | `0xa353a4796c9f6eee9bed9cd62f1d3aaf84b01bc79af6461e52399049d2b908d1` | [view](https://explorer.arc.io/tx/0xa353a4796c9f6eee9bed9cd62f1d3aaf84b01bc79af6461e52399049d2b908d1) |
| 1 | Claim 0.021 USDC | `0xdb949920e22b89afaf16cb351d99067b46d1468250a5c24a4ec7b5fa073af15a` | [view](https://explorer.arc.io/tx/0xdb949920e22b89afaf16cb351d99067b46d1468250a5c24a4ec7b5fa073af15a) |
| 1 | Claim 0.039 USDC | `0x25584b8c61fe24b085d663bf05b8cff9038222f849d4f99364056230107375d5` | [view](https://explorer.arc.io/tx/0x25584b8c61fe24b085d663bf05b8cff9038222f849d4f99364056230107375d5) |
| 2 | Create (tranches 3×0.02 USDC) | `0x837f6caef278fa4204a2f136b38328e1ad3e5ebb0fcf4ac7c92db6a061898155` | [view](https://explorer.arc.io/tx/0x837f6caef278fa4204a2f136b38328e1ad3e5ebb0fcf4ac7c92db6a061898155) |
| 2 | Claim tranche 1 | `0xe68d14f19af735146bd9ccf3eeb6eca5d9d5215eb8b00647f8f819c814370ae9` | [view](https://explorer.arc.io/tx/0xe68d14f19af735146bd9ccf3eeb6eca5d9d5215eb8b00647f8f819c814370ae9) |
| 3 | Create (revocable 0.10 USDC) | `0xaaca91fd9bcf32f9a9c923a67da46c55b2be90f0447ce11ab1a9ad6bf97fb5e7` | [view](https://explorer.arc.io/tx/0xaaca91fd9bcf32f9a9c923a67da46c55b2be90f0447ce11ab1a9ad6bf97fb5e7) |
| 3 | Cancel (0.064167 USDC back to funder) | `0x63f85049343b4369ea25285de4d9c93529f3a5e1ba1ac37e7cabe8dde4e72b57` | [view](https://explorer.arc.io/tx/0x63f85049343b4369ea25285de4d9c93529f3a5e1ba1ac37e7cabe8dde4e72b57) |
| 3 | Claim 0.035833 USDC (beneficiary, post-cancel) | `0xe4db89e8555b8474f61164af02f89c9bd904c4e462162aa17fb0e3c4951b8463` | [view](https://explorer.arc.io/tx/0xe4db89e8555b8474f61164af02f89c9bd904c4e462162aa17fb0e3c4951b8463) |

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
- Self-hosted fonts via `@fontsource` (Space Grotesk, DM Sans, JetBrains Mono)
- No external RPC proxies — uses Arc's public RPC endpoints directly
- Production CSP via Vite `transformIndexHtml` plugin

## Limitations

- No beneficiary change after creation.
- No arbiter or dispute resolution.
- All schedule data is public on-chain.
- A contract beneficiary that cannot receive native USDC cannot be paid (see above).
- Timeline scan starts from the deployment block; very long histories may take a few seconds.
