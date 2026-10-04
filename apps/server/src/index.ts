import { bootstrap } from './composition-root'

let server: ReturnType<typeof bootstrap>
try {
  server = bootstrap()
} catch (e) {
  console.error('[server] bootstrap failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
}

// `docker stop` / Ctrl-C: stop the loops, close the sockets and exit at once. As a container's PID 1
// the process gets no default signal handling, so without this every stop waits out the 10 s kill.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.stopLoop()
    server.stop(true)
    process.exit(0)
  })
}
