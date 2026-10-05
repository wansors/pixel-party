# Pixel Party — Docker image

**Pixel Party** is a party game for a LAN: one machine runs the server, and everyone plays 55
mini-games in the browser of their own device (PC first, phones welcome). No accounts, no database, no
internet needed during the party.

This image is the **whole game in one container**:
- the game server (Bun, bundled into a single `server.js`);
- the web client it serves;
- the REST API and the WebSocket.

They all share **one port**. Source code and full docs: <https://github.com/wansors/pixel-party>.

## Quick start

```bash
docker run -d --name pixel-party --restart unless-stopped \
  -p 3000:3000 \
  -e PUBLIC_URL=http://192.168.1.50:3000 \
  wansors/pixel-party:latest
```

Then, on every device on the same network, open **`http://<IP of the machine running Docker>:3000`**
(in the example, `http://192.168.1.50:3000`). Someone creates a room, the others join with its 4-letter
code or link, and the host starts the party.

- `PUBLIC_URL` is optional. It's only the address the server prints in its log for players to open
  (see below). Replace `192.168.1.50` with your machine's LAN IP:
  - Linux: `hostname -I`;
  - macOS: `ipconfig getifaddr en0`;
  - Windows: `ipconfig`.
- Check it's up: `docker logs pixel-party` shows `Pixel Party vX.Y.Z is on — open … on every device`,
  and `curl http://localhost:3000/api/health` answers `{"ok":true,"version":"X.Y.Z"}`.

## Ports

The image publishes **one port**. Everything goes through it:

| Container port | Protocol | What goes through it |
|---|---|---|
| **3000** | TCP (HTTP + WebSocket) | the web client (`/`, `/room/<code>`), the API (`/api/…`) and the game's real-time connection (`/ws`) |

- **Change the port players use** with the left side of `-p`: `-p 8080:3000` → players open
  `http://<IP>:8080`. That's the simplest way, and the container keeps listening on 3000 inside.
- Or change the port inside the container with `PORT` and map that one instead:
  `-e PORT=8080 -p 8080:8080`.
- **Open that port in the host's firewall** for the local network. On Windows/macOS, Docker Desktop
  may ask you to allow it the first time.
- No other ports, no UDP, nothing outbound: the game never calls the internet.

## Environment variables

All are optional; the defaults are what a LAN party needs. Set them with `-e NAME=value` (or
`environment:` in Compose).

### The ones you might change

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | *(empty)* | The address printed in the startup log for players to open, e.g. `http://192.168.1.50:3000`. Inside a container the server only sees its internal Docker IP (172.x.x.x), which players can't reach, so set it if you go by the log. It changes nothing else. |
| `PORT` | `3000` | Port the server listens on **inside** the container. Map the same one with `-p`. |
| `BASE_PATH` | *(empty)* | Serve the game below a path instead of the domain root, e.g. `/pixel-party` → `https://example.com/pixel-party/`. For reverse proxies that host several apps on one domain; see *Under a path*. |
| `ROOM_MAX_PLAYERS` | `12` | Seats per room. 12 is the most any game is built for, so higher values are capped at 12. Each game also declares its own player range; the lobby shows which ones fit the room. |
| `HANDICAP_ENABLED` | `false` | Whether new rooms start with the **catch-up** option on: up to a bonus for the players furthest behind, so the ranking stays open. The host can still switch it on/off in every lobby. |
| `HANDICAP_MAX_BONUS_PCT` | `20` | Size of that catch-up bonus: at most this many percent extra points per round, for the player furthest behind (0–100). |
| `ROOM_IDLE_TIMEOUT_SEC` | `900` | A room with nobody connected is closed after this many seconds (15 min). |

### Advanced (leave them alone unless you know why)

| Variable | Default | What it does |
|---|---|---|
| `ALLOWED_ORIGINS` | *(empty)* | Extra web origins allowed to open the game's WebSocket, comma-separated (e.g. `https://party.example.com`). The pages this server serves are **always** allowed, so you only need it if the client is served from another address than the server (an unusual reverse-proxy setup). |
| `WS_IDLE_TIMEOUT_SEC` | `60` | Seconds without traffic before a player's connection is dropped. The server pings every connection, so an idle but present player is never dropped; a vanished one is. |
| `ROOM_CODE_LEN` | `4` | Length of room codes. |
| `TICK_HZ` | `20` | Simulation rate of the real-time games. The games are tuned for 20. |
| `SNAPSHOT_EVERY_N_TICKS` | `3` | How often the real-time games send their state. The client's smoothing is tuned for 3. |
| `RNG_SEED` | `1` | Seed for the server's game randomness (line-ups, layouts). Not a secret; any integer. |
| `SERVE_CLIENT` | `true` | `false` turns the server into API + WebSocket only (no web page). The image is meant to serve it. |
| `CLIENT_DIR` | `/app/client` | Where the web client lives inside the image. Don't change it. |

`NODE_ENV` has no effect: the image is always built in production mode.

## Storage and volumes

**None.** Rooms, players and scores live only in memory, by design: no accounts, no history, nothing
written to disk. Restarting the container ends every room in progress, so do updates between parties.
The image runs as the unprivileged `bun` user and also works with `--read-only`.

## Security

- The container runs as the unprivileged `bun` user, writes nothing, and works `--read-only`.
- Every page carries a strict Content-Security-Policy: scripts, styles, fonts, music and the
  WebSocket may only come from this server.
- The server survives anything a client sends. Malformed messages are refused, frames are capped at
  64 KB, names are cleaned, and rooms are capped at 100. A game that crashes only loses its round.
- A seat can only be reclaimed by the tab that holds its secret token.
- It was built for a **trusted LAN** and has no accounts or passwords. Don't expose the port to the
  internet. Details: <https://github.com/wansors/pixel-party/blob/develop/docs/security-audit.md>.

## Health and monitoring

- **Health check** built into the image: `GET /api/health` every 30 s. `docker ps` / `podman ps` show
  `healthy`.
- `GET /api/health` → `{"ok":true,"version":"1.2.0"}`: the running version, handy when a tab shows an
  old one.
- `GET /api/metrics` → JSON with the live gauges (`active_rooms`, `running_sessions`) and counters since
  start (`rooms_created`, `players_joined`, `sessions_started`, `rounds_skipped`, `errors`…).
- **Logs**: one JSON line per event on stdout (`docker logs -f pixel-party`).

## Resources

Measured with 10 players on the real-time games: about **1 % of one CPU core** (peaks of 10 %),
**~55 MB of RAM** and **~180 kB/s** of network traffic in total. Any machine that can run Docker is
enough; generous limits for safety:

```bash
docker run … --memory 256m --cpus 1 …
```

Each device downloads about **0.7 MB** of game code plus **5.6 MB** of music the first time. Use a
cable for the server if you can; over Wi-Fi, the router matters more than the server.

## Docker Compose

```yaml
services:
  pixel-party:
    image: wansors/pixel-party:latest
    container_name: pixel-party
    restart: unless-stopped
    ports:
      - "3000:3000"          # host:container. Players open http://<host IP>:3000
    environment:
      PUBLIC_URL: "http://192.168.1.50:3000"   # optional: what the log tells players to open
      # ROOM_MAX_PLAYERS: "12"
      # HANDICAP_ENABLED: "false"
    read_only: true
    mem_limit: 256m
```

`docker compose up -d` to start, `docker compose pull && docker compose up -d` to update.

## Network setups

- **Standard (any OS)**: `-p 3000:3000`, as above. Set `PUBLIC_URL` if you want the log to show the
  right address.
- **Linux, host network**: `docker run -d --network host wansors/pixel-party`. No `-p`
  needed. The server sees the real LAN addresses and prints them itself. Change the port with
  `-e PORT=…`.
- **Behind a reverse proxy** (nginx, Caddy, Traefik): forward everything to port 3000, **including
  the WebSocket upgrade on `/ws`**, and keep the `Host` header *with its port* (nginx:
  `$http_host`, not `$host`). Nginx also needs `proxy_http_version 1.1`, `Upgrade` and `Connection`
  headers. Caddy and Traefik forward WebSockets by default.
- **Hosting platforms** must allow WebSockets on the plan you use. Some only do on paid tiers, and
  then the page loads but stays on "Connecting…".

### Under a path (`BASE_PATH`)

To serve the game at `https://example.com/pixel-party/` next to other apps, start it with
`-e BASE_PATH=/pixel-party`. The server writes that path into the page's `<base href>`, so the
bundles, the font, the music, the API, the WebSocket, the invite links and the room URLs all live
below it. `https://example.com/pixel-party` (no slash) redirects to the slash.

It works with either kind of proxy rule. The server accepts requests with the prefix and without it,
so pick whichever your proxy does:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 443 ssl;
  server_name example.com;

  location /pixel-party/ {
    proxy_pass http://127.0.0.1:3000;     # passes /pixel-party/... through as is
    # proxy_pass http://127.0.0.1:3000/;  # or strips it: the game copes with both
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

Caddy: `handle_path /pixel-party/* { reverse_proxy 127.0.0.1:3000 }`, which strips the prefix, or
`handle /pixel-party/* { reverse_proxy 127.0.0.1:3000 }`, which keeps it. The health check (and
`/api/health`) answers on both paths.

## Tags and platforms

| Tag | Meaning |
|---|---|
| `latest` | The newest release. |
| `1.4.0` | That exact release, never moves. Pin this for a party you've tested. |
| `1.4`, `1` | The newest release of that minor / major line. |

Images are built for **linux/amd64** and **linux/arm64**: PCs, Macs with Apple Silicon, Raspberry Pi
4/5. Every change that lands on the main branch, passes the tests and builds is published as a new
version.

## Updating

```bash
docker pull wansors/pixel-party:latest
docker rm -f pixel-party
docker run -d --name pixel-party … (same command as before)
```

Players should reload the page afterwards. A tab still running an older version gets a "please
refresh" notice when the game protocol changed.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Other devices can't open the page | Wrong IP (use the host's LAN IP, not `localhost` or 172.x), the firewall blocks the port, or the devices are on a guest Wi-Fi that isolates clients. |
| The page loads but stays on "Connecting…" | A proxy in between doesn't forward the WebSocket on `/ws` (see *Behind a reverse proxy*). |
| `Forbidden origin` in the logs | The page comes from an address other than this server. Add it to `ALLOWED_ORIGINS`. |
| "Room not found" after a restart | Expected: rooms live in memory, so create a new one. |
