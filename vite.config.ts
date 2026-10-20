import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Inject CSP + referrer meta only for production builds
const productionSecurityPlugin: Plugin = {
  name: 'production-security-headers',
  apply: 'build',
  transformIndexHtml(html) {
    const csp = [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src https://rpc.mainnet.arc.io https://rpc.testnet.arc.io",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ')

    const headInsert = [
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      `<meta name="referrer" content="strict-origin-when-cross-origin">`,
    ].join('\n    ')

    return html.replace('<head>', `<head>\n    ${headInsert}`)
  },
}

export default defineConfig({
  base: './',
  plugins: [react(), nodePolyfills(), productionSecurityPlugin],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
  },
})
