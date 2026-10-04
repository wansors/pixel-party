# Pre-release code audit (2026-10-04)

The repository and the Docker image go public for the 1.0.0 beta. This audit asked what someone could
do with them. A hostile client on the party's network could send the server anything. Anyone could
read the code, its history and the image. And we had to check the secrets and licenses that ship with
it. Decision log: D37.

## Method

- **Secrets and personal data**: every tracked file and the whole history of `develop` was grepped
  for keys, tokens, private keys, `.env` files and personal names, e-mails and paths. Every commit
  identity in the repository was listed too.
- **Server attack surface**: the WebSocket and HTTP handlers, the message validator, the join and
  rejoin flows, the static file server and the room store were reviewed by hand. Every suspicion was
  then confirmed against a live server with a probe script.
- **Game input fuzzing**: all 55 mini-games, at their minimum and maximum player counts, received
  1,500 random inputs each, interleaved with ticks. The inputs were built from every input `kind` and
  field name the shared wire types declare, plus wrong types, extreme numbers and `__proto__` keys.
  Now a permanent test: `apps/server/src/domain/minigames/inputFuzz.test.ts`.
- **Protocol fuzzing**: ~9,000 random intents of every type with absurd values, against a live
  server. They came from rotating clients in 6 rooms, with sessions, skips, kicks and host transfers
  happening.
- **The image**: built with Podman from the `Dockerfile` and run `--read-only`. A full session was
  played against it in headless Chrome. The health check, the headers and the attack probes were
  re-run against the container.
- **CI and supply chain**:
  - `actionlint` and `hadolint`;
  - the token permissions, action pinning and script-injection paths in `ci.yml`;
  - `bun audit`.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | One message, `{"type":"MINIGAME_INPUT","input":null}`, crashed the whole server process. Every room ended. | Fixed |
| 2 | **Critical** | A `JOIN` with a blank name (`"   "`) crashed the server the same way. | Fixed |
| 3 | High | Any player could take any seat, the host's included: `REJOIN` only asked for the player id, and every `LOBBY_STATE` lists the ids. | Fixed |
| 4 | High | The image ran Bun's HTTP server in development mode. A malformed URL got a 500 with Bun's debug page (stack trace and source). | Fixed |
| 5 | Medium | Names, colors and avatars were taken as sent. A name could be megabytes long and was relayed to everyone, and Bun accepted 16 MB frames. | Fixed |
| 6 | Medium | `POST /api/rooms` had no limit, so a script could fill the memory with empty rooms. | Fixed |
| 7 | Medium | No error containment: a bug in one game's `tick` would have stopped the simulation loop for every room. | Fixed |
| 8 | Medium | CI gave every job the repository's default token scope. Actions were pinned by mutable tags, although the release job hands them the Docker Hub token. A dispatch input was interpolated into a shell script. | Fixed |
| 9 | Medium | The image shipped third-party code (Angular, Phaser, rxjs, Transloco…) without its license notices. | Fixed |
| 10 | Low | No browser hardening headers (CSP, `nosniff`, framing). | Fixed |
| 11 | — | The background music was made with Suno; its terms depend on the plan it was made with. | **Owner's decision** |
| 12 | — | Two spellings of the owner's name: `LICENSE` says "Andrea Cisneros", `docs/PRD.md` says "Andrés Cisneros". | **Owner's decision** |
| 13 | Info | The local repository keeps `refs/original/*`, a backup left by an earlier `git filter-branch`, with 34 commits under a work e-mail. Plain pushes never send these refs, and GitHub has none of them. | Recommendation |
| 14 | Info | `docs/promo/` holds 35 MB of video in git, which every clone downloads. | Accepted |
| 15 | Info | No per-socket message rate limit; the origin check only stops browsers. | Accepted (LAN) |

No secrets were found in the tree or the history. `bun audit` reports 0 advisories. Apart from the
`null` input, the 55 games handled every malformed input without an exception or a NaN reaching a
client.

## Fixes

- **1, 2, 7: nothing a client sends can take the process down.**
  - The validator accepts a `MINIGAME_INPUT` only if its `input` is a JSON object.
  - Every WebSocket handler, the room sweeper and each session's tick run inside a guard that logs
    `handler_failed` / `session_failed` with the stack.
  - An input that makes a game throw is dropped. A game that throws while ticking loses its round:
    the server skips it, everyone sees "… broke down and was skipped", and the next round starts.

  Regression tests: `test/socket.test.ts` and the input fuzzer.
- **2, 5: identity is cleaned on the server.**
  - Names go through the shared `cleanName`: control and invisible characters are dropped, spaces
    collapsed, and the length capped at 16. A name left empty is rejected with `invalid_name`.
  - A color or avatar outside the offered sets falls back to the first one.
  - Frames are capped at 64 KB.
- **3: seats need a secret.** `WELCOME` now carries a `rejoinToken`, sent only to that seat's own
  socket. `REJOIN` must echo it; a wrong token is answered like a gone seat. The protocol version
  went from 4 to 5, so an old tab is asked to refresh.
- **4: production in the image.** `NODE_ENV=production` in the runtime image, and
  `development: config.isDevelopment` passed to `Bun.serve`. A malformed `%` escape in a URL is now a
  plain 404.
- **6: rooms are capped at 100** (`MAX_ROOMS`). Past that, `POST /api/rooms` answers 503.
- **8: CI.**
  - Read-only token by default; only the release job may write.
  - Every action pinned to a commit SHA, with Dependabot keeping them current.
  - The dispatch input reaches the shell through `env`.
  - The release only needs the `DOCKERHUB_TOKEN` secret and stays idle without it.
- **9: licenses in the image.** `/app/licenses/` holds the project `LICENSE` and the Angular build's
  third-party notices. The pixel font's OFL already travels in `client/fonts/`.
- **10: headers.** Every page and asset carries a strict Content-Security-Policy (only this origin,
  inline styles for Angular, `data:`/`blob:` images for Phaser), `X-Content-Type-Options: nosniff`
  and `Referrer-Policy: no-referrer`, and the page can't be framed. Angular's critical-CSS inlining is
  off, because its inline `<script>` would break under the policy.

  Verified: a full session in headless Chrome logs no CSP violation.

## For the owner

- **11, music.** `apps/client/public/audio/background-song.mp3` goes into the public repository and
  every image. As far as Suno's published terms go, songs made on a paid plan belong to their author.
  Songs made on the free plan stay Suno's and may only be used non-commercially, with credit. Check
  the plan it was made with. If it was the free one, add a credit line, for example "Music made with
  Suno" in the README and the options panel, or replace the track.
- **12, name.** Pick one spelling (or the handle `wansors`) for `LICENSE` and the PRD.
- **13, old history.** Before a `git push --mirror`, or just to tidy up:
  `git for-each-ref --format='%(refname)' refs/original | xargs -n1 git update-ref -d`, then
  `git reflog expire --expire=now --all && git gc --prune=now`. This permanently deletes the backup of
  the history from before the rewrite.
- **Docker Hub token**: GitHub secrets are write-only and can't be shared between a personal account's
  repositories, so the token from `lightweight-config-server` can't be read back or reused from there.
  Create a dedicated token with *Read, Write, Delete* permissions and add it as `DOCKERHUB_TOKEN`
  ([`release.md`](release.md)).

## Accepted

- **No message rate limit.** A real game sends up to a few dozen inputs a second, and on a LAN the
  people who could flood the server are the party's own guests. Rooms, frames and names are bounded,
  and nothing can crash the process.
- **The origin check stops browsers only.** It blocks other websites from opening a socket to the
  server. A script can fake `Origin`, which is why the seat token and the validation above exist.
- **Room codes can be enumerated.** A guest on the LAN could probe the codes (`/api/rooms/:code`).
  The codes are 4 characters and rooms carry no private data.
