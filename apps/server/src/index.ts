import { bootstrap } from './composition-root'

try {
  bootstrap()
} catch (e) {
  console.error('[server] bootstrap failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
}
