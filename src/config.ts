/**
 * wagmi configuration for UsdcVesting
 * Two chains: Arc Mainnet (5042) + Arc Testnet (5042002)
 */
import { http, createConfig } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { arcMainnet } from './config/networks'

export const config = createConfig({
  chains: [arcMainnet, arcTestnet],
  connectors: [injected()],
  transports: {
    [arcMainnet.id]: http('https://rpc.mainnet.arc.io'),
    [arcTestnet.id]: http('https://rpc.testnet.arc.io'),
  },
})
