import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim())
  const apiBaseUrlEnv = String(env.VITE_API_BASE_URL || '').trim()
  const webSimDesktop = String(env.VITE_WEB_SIMULATE_DESKTOP || '').trim().toLowerCase() === 'true'
  const devProxyTarget =
    env.VITE_DEV_PROXY_TARGET ||
    (isHttpUrl(apiBaseUrlEnv) ? apiBaseUrlEnv : '') ||
    (webSimDesktop ? 'http://127.0.0.1:3003' : '') ||
    'https://erp-system-prod-1glmda1zf4f9c7a7-1367197884.ap-shanghai.app.tcloudbase.com/api-bridge'
  const shouldRewriteApiPrefix = isHttpUrl(devProxyTarget) && String(devProxyTarget).includes('api-bridge')

  return ({
    base: command === 'build' ? './' : '/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3002,
      strictPort: true,
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: shouldRewriteApiPrefix ? (p) => p.replace(/^\/api/, '') : undefined,
          configure: (proxy, options) => {
            proxy.on('error', (err, req, res) => {
              console.log('proxy error', err);
            });
            proxy.on('proxyReq', (proxyReq, req, res) => {
              console.log('Sending Request to the Target:', req.method, req.url);
            });
            proxy.on('proxyRes', (proxyRes, req, res) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
            });
          }
        }
      }
    },
    build: {
      outDir: 'web-dist',
      sourcemap: false,
      chunkSizeWarningLimit: 5000,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              return 'bundle'
            }
          }
        }
      }
    },
    define: command === 'build'
      ? {
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL || 'https://erp-system-prod-1glmda1zf4f9c7a7-1367197884.ap-shanghai.app.tcloudbase.com/api-bridge'),
        'import.meta.env.VITE_ELECTRON_USE_LOCAL_BACKEND': JSON.stringify(process.env.VITE_ELECTRON_USE_LOCAL_BACKEND || 'false')
      }
      : undefined
  })
})
