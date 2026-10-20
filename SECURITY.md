# Security

USDC Vesting is a single Solidity contract (`contracts/UsdcVesting.sol`) and a static web app. Report problems through a
GitHub issue on this repository (for anything that could put funds at risk, open an issue that only says "security
contact please" and we will reach out).

## What the contract guarantees
- No owner, no admin, no fees, no pause, no upgrades, no `receive()` / `fallback()`: USDC only enters through
  `createLinear` / `createTranches`, and the whole schedule is funded up front.
- Accounting identity at all times: per schedule `claimed + refunded + locked == total`, and the contract balance equals
  `totalLocked`.
- `claim` is permissionless, but the funds always go to the schedule's beneficiary (a funder or keeper can push payroll).
  `claimed` never exceeds `vestedAmount(id, now)`.
- `cancel` (funder only, revocable schedules only, once) returns only the part that has not vested yet; the vested part
  stays claimable by the beneficiary forever, and the vesting curve is frozen at the cancel time.
- `claim` and `cancel` are `nonReentrant`; effects happen before the transfer; custom errors for every rejection.

## Known limitations
- The beneficiary cannot be changed and there is no arbiter: a schedule runs exactly as created.
- A beneficiary that cannot receive native USDC (for example a contract without a payable fallback, or a blocklisted
  address) cannot be paid; its vested amount stays in the contract.
- All schedules, amounts and addresses are public on-chain data.
- The app is served by GitHub Pages, which cannot send `X-Frame-Options` / `frame-ancestors` headers; the app refuses to
  run inside frames other than Arc Studio's preview, and production builds carry a strict Content-Security-Policy meta
  tag. Your wallet still shows every transaction before you sign.

## Testing
Foundry unit, fuzz and stateful invariant tests (`contracts/test/`), written and run by Arc Studio and re-run by us in an
offline sandbox. The deployed mainnet bytecode is byte-identical to the Arc Testnet deployment made by Arc Studio (our
deploy script checks this before sending), and the source is verified on explorer.arc.io.
