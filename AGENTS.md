# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Deployed Contracts

### UsdcVesting (Arc Testnet)
- Address: `0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32`
- Tx Hash: `0xc9504b6f6f930b1c92db81495ecebab277db9a59189143f3ac59a7ef410181d7`
- Deployed: 2026-10-20T02:31:25Z
- Explorer: https://explorer.testnet.arc.io/address/0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32
- Source: `contracts/UsdcVesting.sol`
- ABI: `contracts/contract-metadata/UsdcVesting.json`
- Native USDC vesting (msg.value, 18 decimals). Supports LINEAR and TRANCHES schedules. No owner/admin/fees/upgrades. ReentrancyGuard only.

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
