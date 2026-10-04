import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Router } from '@angular/router'
import { TranslocoService } from '@jsverse/transloco'
import {
  type AvatarId,
  MINIGAMES,
  MINIGAMES_BY_ID,
  type MiniGameFormat,
  type MiniGameId,
  type PlayerDto,
  type PlayerRadarDto,
  type RoundResultDto,
  SKILL_AXES,
  type ScoreEntryDto,
  type ServerMsg,
  type SessionSummaryDto,
  TEAMS,
  type TeamId,
  type TeamRoundResult,
  fitsPlayers,
} from '@pp/shared'
import { GameClient } from '../../../game/GameClient'
import { toAvatarId } from '../../../game/avatarSprites'
import { linesOf, pickLine } from '../../../game/quips'
import { AudioService } from '../../core/audio/audio.service'
import { CatalogI18nService } from '../../core/i18n/catalog-i18n.service'
import { localizeStat } from '../../core/i18n/stat-i18n'
import { GameSocketService } from '../../core/net/game-socket.service'
import type { RadarAxis } from '../../shared/skill-radar.component'

export type RoomView = 'connecting' | 'lobby' | 'intro' | 'round' | 'round-result' | 'final'

export interface Identity {
  name: string
  color: string
  avatar: AvatarId
}

export interface RoundIntro {
  round: number
  total: number
  game: MiniGameId
  format: MiniGameFormat
}

// One row of the live in-round board: session standing plus this round's raw tally (if readable).
export interface LiveRow {
  playerId: string
  rank: number
  points: number
  roundValue: number | null
  roundLeader: boolean
}

const NEUTRAL = '#7b88a8'

// A phone or tablet: the primary pointer is a finger. Touchscreen laptops keep a fine pointer, so they
// count as PCs.
const onTouchDevice = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// Best-effort read of "how each player is doing so far this round" out of a mini-game's snapshot.
// Snapshot shapes vary per game (see packages/shared/src/games/*), but most FFA games expose one of
// these player-id-keyed, higher-is-better tallies. Games without one simply show no round column.
export function extractLiveMetric(state: unknown): Record<string, number> | null {
  if (typeof state !== 'object' || state === null) return null
  const rec = state as Record<string, unknown>
  for (const key of ['scores', 'counts', 'progress']) {
    const v = rec[key]
    if (v && typeof v === 'object' && Object.values(v).every((n) => typeof n === 'number')) {
      return v as Record<string, number>
    }
  }
  return null
}

// Dense 1-based ranks from a player → value map, higher value = better (ties share a rank).
function denseRanks(entries: [string, number][]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b[1] - a[1])
  const ranks = new Map<string, number>()
  let rank = 1
  let prev: number | undefined
  sorted.forEach(([id, v], idx) => {
    if (idx > 0 && v !== prev) rank = idx + 1
    prev = v
    ranks.set(id, rank)
  })
  return ranks
}

// The room's whole client-side state machine, provided per RoomComponent: it owns the socket
// subscription, turns server messages into signals the view components render, sends intents, and
// drives the Phaser GameClient (booted outside the Angular zone so its rAF never triggers change
// detection). View components are thin templates over this store.
@Injectable()
export class RoomStore {
  private readonly net = inject(GameSocketService)
  private readonly audio = inject(AudioService)
  private readonly router = inject(Router)
  private readonly zone = inject(NgZone)
  private readonly destroyRef = inject(DestroyRef)
  private readonly transloco = inject(TranslocoService)
  private readonly catalog = inject(CatalogI18nService)

  readonly code = signal('')
  readonly view = signal<RoomView>('connecting')
  readonly players = signal<PlayerDto[]>([])
  readonly hostId = signal('')
  readonly selfId = signal('')
  readonly isHost = signal(false)
  readonly reconnecting = signal(false)
  readonly message = signal('')
  // A short, neutral heads-up for everyone (e.g. "the host skipped this game"); clears itself.
  readonly notice = signal('')

  // Host session config (mirrors LOBBY_STATE so everyone sees the current selection).
  readonly selectedGameIds = signal<MiniGameId[]>([])
  readonly rounds = signal(0)
  // True when the line-up includes a team game — the lobby then shows team assignment.
  readonly usesTeams = signal(false)
  // Bounded scoring catch-up toggle (Phase 3), mirrored from LOBBY_STATE.
  readonly handicap = signal(false)

  readonly intro = signal<RoundIntro | null>(null)
  readonly countdown = signal<number | null>(null)
  readonly roundResult = signal<{ round: number; result: RoundResultDto } | null>(null)
  readonly scoreboard = signal<ScoreEntryDto[]>([])
  // Cumulative standings as of the previous round, kept to derive rank movement arrows.
  readonly previousScoreboard = signal<ScoreEntryDto[]>([])
  // The current round's live in-progress tally (from ROUND_STATE); null when unreadable.
  readonly liveMetric = signal<Record<string, number> | null>(null)
  readonly final = signal<ScoreEntryDto[]>([])
  // Round-result flavor text per player (e.g. "MONSTER KILL!!!"), picked once per round.
  readonly roundCallouts = signal<Record<string, string>>({})
  // Phase 4 post-match analysis (on ROUND_RESULT so far, and on FINAL_RANKING).
  readonly radars = signal<PlayerRadarDto[]>([])
  readonly summary = signal<SessionSummaryDto | null>(null)

  private game?: GameClient
  private defaultConfigSent = false
  private countdownTimer?: ReturnType<typeof setInterval>
  private noticeTimer?: ReturnType<typeof setTimeout>
  // Consecutive round wins per player, used to bump a winner's callout to the "streak" tier.
  private readonly winStreak = new Map<string, number>()
  private identity: Identity = { name: '', color: NEUTRAL, avatar: 'cat' }

  // ── Derived state ──────────────────────────────────────────────────────────────────────────────
  readonly me = computed(() => this.players().find((p) => p.id === this.selfId()))
  readonly myReady = computed(() => this.me()?.ready ?? false)
  readonly readyCount = computed(() => this.players().filter((p) => p.ready && p.connected).length)
  readonly connectedCount = computed(() => this.players().filter((p) => p.connected).length)
  // Someone is playing from a phone: only then are the mobile-friendly badges and filter worth showing
  // (a LAN party is PC-first, D21).
  readonly phoneInRoom = computed(() => this.players().some((p) => p.connected && p.touch))
  // Connected players per team (only meaningful once the line-up uses teams).
  readonly teamSizes = computed(() =>
    TEAMS.map((t) => this.players().filter((p) => p.connected && p.team === t.id).length),
  )
  // The part of the line-up this room actually plays (D27/D28): picked games that fit (see `fits`). The
  // rest stay picked and come back if people join or leave.
  readonly playableGameIds = computed(() =>
    [...new Set(this.selectedGameIds())].filter((id) => this.fits(id)),
  )
  // Rounds as the session will run them: the engine caps the count at the playable line-up.
  readonly effectiveRounds = computed(() =>
    Math.min(this.rounds() || this.playableGameIds().length, this.playableGameIds().length),
  )

  // The round being played / just played, for the header ("ROUND 2/5 · FRUIT CATCH").
  readonly currentRound = computed(() => {
    const view = this.view()
    const intro = this.intro()
    if (!intro || (view !== 'intro' && view !== 'round' && view !== 'round-result')) return null
    return intro
  })

  // Live board rows: ordered by session standing (cumulative points), with this round's live tally as
  // the tiebreak and an extra column — the board always answers "who's winning the SESSION", while
  // still moving in real time (round leader marked) as the current mini-game plays out.
  readonly liveRows = computed<LiveRow[]>(() => {
    const metric = this.liveMetric()
    const cumulative = new Map(this.scoreboard().map((s) => [s.playerId, s.points]))
    const rows = this.players().map((p) => ({
      playerId: p.id,
      points: cumulative.get(p.id) ?? 0,
      roundValue: metric ? (metric[p.id] ?? 0) : null,
    }))
    rows.sort((a, b) => b.points - a.points || (b.roundValue ?? 0) - (a.roundValue ?? 0))
    const ranks = denseRanks(rows.map((r) => [r.playerId, r.points]))
    const best = Math.max(0, ...rows.map((r) => r.roundValue ?? 0))
    return rows.map((r) => ({
      ...r,
      rank: ranks.get(r.playerId) ?? 1,
      roundLeader: best > 0 && r.roundValue === best,
    }))
  })

  // Winner of the just-finished round = first in the placement ordering (empty if nobody scored).
  readonly roundWinnerId = computed(() => this.roundResult()?.result.placements[0] ?? null)
  // Team ranking behind the current round result (empty for FFA rounds); rank 0 = winning team.
  readonly resultTeams = computed<TeamRoundResult[]>(() => this.roundResult()?.result.teams ?? [])
  readonly winningTeam = computed(() => this.resultTeams().find((t) => t.rank === 0) ?? null)

  // The viewing player's skill radar over ALL axes in the shared order: a radar needs every axis as a
  // vertex to read as a shape. Axes not played yet are null — drawn neutral and dimmed, not as a 0.
  readonly myRadar = computed<RadarAxis[]>(() => {
    const mine = this.radars().find((r) => r.playerId === this.selfId())
    if (!mine) return []
    return SKILL_AXES.map((axis) => ({
      label: this.catalog.axisLabel(axis),
      value: mine.axes[axis] ?? null,
    }))
  })
  readonly hasProfile = computed(() => {
    const mine = this.radars().find((r) => r.playerId === this.selfId())
    return !!mine && Object.keys(mine.axes).length > 0
  })

  get inviteUrl(): string {
    return `${location.origin}/?code=${this.code()}`
  }

  private pidKey(): string {
    return `pp:pid:${this.code()}`
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────
  connect(code: string, identity: Identity): void {
    this.code.set(code)
    this.identity = identity
    this.audio.ensureMusic()

    // A seat id persisted from an earlier connection lets a page reload / socket drop rejoin in place.
    const storedId = sessionStorage.getItem(this.pidKey())
    if (storedId) this.net.restoreIdentity(storedId)

    this.net.connected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((up) => {
      if (!up) return
      // With a known id this is a reconnect → reclaim the seat; otherwise it is a first-time join.
      if (this.net.playerId) this.net.send({ type: 'REJOIN', playerId: this.net.playerId })
      else this.sendJoin()
    })
    this.net.reconnecting$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.reconnecting.set(r))
    this.net.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((m) => this.handle(m))

    this.zone.runOutsideAngular(() => this.net.connect(code))
    this.destroyRef.onDestroy(() => {
      this.clearCountdown()
      clearTimeout(this.noticeTimer)
      this.game?.destroy()
      this.net.disconnect()
    })
  }

  private sendJoin(): void {
    const { name, color, avatar } = this.identity
    this.net.send({ type: 'JOIN', name, color, avatar, touch: onTouchDevice() })
  }

  private handle(msg: ServerMsg): void {
    switch (msg.type) {
      case 'WELCOME':
        this.selfId.set(msg.playerId)
        this.isHost.set(msg.isHost)
        sessionStorage.setItem(this.pidKey(), msg.playerId)
        this.game?.handle(msg)
        break
      case 'LOBBY_STATE':
        this.players.set(msg.players)
        this.syncRoster()
        this.hostId.set(msg.hostId)
        this.isHost.set(msg.hostId === this.selfId())
        this.selectedGameIds.set(msg.minigameIds)
        this.rounds.set(msg.rounds)
        this.usesTeams.set(msg.usesTeams)
        this.handicap.set(msg.handicap)
        this.maybeSendDefaultConfig(msg.minigameIds)
        // Keyed off the server's phase (not the current view): a LOBBY_STATE broadcast during an active
        // round (e.g. another player reconnecting) always carries that round's phase, so it never snaps
        // an in-round client back to the lobby — only a genuine lobby phase does (incl. PLAY_AGAIN).
        if (msg.phase === 'lobby') {
          this.view.set('lobby')
          this.audio.playTheme()
        }
        break
      case 'ROUND_INTRO':
        this.intro.set({
          round: msg.round,
          total: msg.totalRounds,
          game: msg.minigameId,
          format: msg.format,
        })
        this.startCountdown(msg.startsInMs)
        this.view.set('intro')
        this.audio.playRound(msg.minigameId, msg.round)
        // Fresh round: drop the previous round's live metric so the board doesn't show stale values.
        this.liveMetric.set(null)
        this.game?.handle(msg)
        break
      case 'ROUND_STATE':
        this.onRoundState(msg)
        break
      case 'ROUND_RESULT':
        this.roundResult.set({ round: msg.round, result: msg.result })
        this.radars.set(msg.result.radars ?? [])
        this.roundCallouts.set(this.buildCallouts(msg.result, msg.round))
        this.view.set('round-result')
        this.audio.playResults()
        if (this.isRoundWinner(msg.result)) this.audio.sfx.win()
        else this.audio.sfx.coin()
        this.game?.handle(msg)
        break
      case 'ROUND_SKIPPED':
        // No result screen: the next ROUND_INTRO (or FINAL_RANKING) is already on its way.
        this.clearCountdown()
        this.showNotice(
          this.transloco.translate(
            msg.byPlayerId === this.selfId() ? 'room.skip.doneSelf' : 'room.skip.done',
            { host: this.playerName(msg.byPlayerId), game: this.gameName(msg.minigameId) },
          ),
        )
        this.audio.sfx.whoosh()
        this.game?.handle(msg)
        break
      case 'SCOREBOARD':
        // Snapshot the outgoing board before it's replaced, so rank movement can be shown.
        this.previousScoreboard.set(this.scoreboard())
        this.scoreboard.set(msg.scores)
        break
      case 'FINAL_RANKING':
        this.final.set(msg.scores)
        this.radars.set(msg.radars ?? [])
        this.summary.set(msg.summary ?? null)
        this.view.set('final')
        this.audio.playTheme()
        this.audio.sfx.fanfare()
        this.game?.destroy()
        this.game = undefined
        break
      case 'KICKED':
        // Host removed this seat: drop the stored id so we don't try to reclaim it, then bounce to the
        // entry screen with a flag the join view surfaces.
        sessionStorage.removeItem(this.pidKey())
        this.net.resetIdentity()
        this.net.disconnect()
        this.router.navigate(['/'], { queryParams: { kicked: 1 } })
        break
      case 'JOIN_REJECTED':
        this.message.set(
          this.transloco.translate('room.joinRejected', {
            reason: this.transloco.translate(`reason.${msg.reason}`),
          }),
        )
        break
      case 'ACK':
        // A refused REJOIN means the seat is gone — clear it and join fresh.
        if (msg.intent === 'REJOIN' && !msg.ok) {
          sessionStorage.removeItem(this.pidKey())
          this.net.resetIdentity()
          this.sendJoin()
          break
        }
        if (msg.ok) break
        // A reason with its own copy reads as a sentence; the rest fall back to "INTENT rejected: x".
        if (msg.reason === 'no_games_fit') {
          this.message.set(this.transloco.translate(`reason.${msg.reason}`))
          break
        }
        this.message.set(
          this.transloco.translate('room.intentRejected', {
            intent: msg.intent,
            reason: msg.reason ?? '',
          }),
        )
        break
      case 'ERROR':
        this.message.set(msg.reason)
        break
      default:
        break
    }
  }

  private onRoundState(msg: Extract<ServerMsg, { type: 'ROUND_STATE' }>): void {
    this.clearCountdown()
    const entering = this.view() !== 'round'
    if (entering) this.view.set('round')
    this.ensureGame()
    const startScene = () => {
      const id = this.intro()?.game
      if (id) this.game?.startRound(id)
    }
    if (entering) {
      // The section only gets its real (flex-sized) box once this view change reaches the DOM. Wait
      // two frames (layout + a safety margin) and re-measure the canvas BEFORE starting the scene, or
      // its content gets laid out against the stale parked size.
      this.zone.runOutsideAngular(() => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            this.game?.refresh()
            startScene()
          }),
        )
      })
    } else {
      startScene()
    }
    this.liveMetric.set(extractLiveMetric(msg.state))
    this.game?.handle(msg)
  }

  // Boot Phaser lazily once the round container is in the DOM, outside the Angular zone.
  private ensureGame(): void {
    if (this.game) return
    this.game = new GameClient(
      (m) => this.net.send(m),
      this.audio.sfx,
      (k, p) => this.transloco.translate(k, p),
    )
    if (this.selfId()) this.game.state.selfId = this.selfId()
    // Lazily created on the round's first ROUND_STATE, so it missed this round's ROUND_INTRO.
    this.game.state.minigameId = this.intro()?.game
    this.syncRoster()
    this.zone.runOutsideAngular(() => {
      requestAnimationFrame(() => this.game?.boot('game-container'))
    })
  }

  // Mirrors the roster's display names, colors and avatars into the Phaser-side RoundState, so mini-game scenes
  // can show real names/colors instead of falling back to a slice of the player id.
  private syncRoster(): void {
    if (!this.game) return
    const players = this.players()
    this.game.state.names = Object.fromEntries(players.map((p) => [p.id, p.name]))
    this.game.state.colors = Object.fromEntries(
      players.map((p) => [p.id, Number.parseInt(p.color.slice(1), 16)]),
    )
    this.game.state.avatars = Object.fromEntries(players.map((p) => [p.id, toAvatarId(p.avatar)]))
  }

  private startCountdown(startsInMs: number): void {
    this.clearCountdown()
    let n = Math.max(1, Math.ceil(startsInMs / 1000))
    this.countdown.set(n)
    this.audio.sfx.tick()
    this.countdownTimer = setInterval(() => {
      n -= 1
      this.countdown.set(n > 0 ? n : null)
      if (n > 0) this.audio.sfx.tick()
      else {
        this.audio.sfx.go()
        this.clearCountdown()
      }
    }, 1000)
  }

  private clearCountdown(): void {
    if (this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = undefined
    }
  }

  // First host to see an unconfigured room seeds a default line-up so a session can start immediately.
  private maybeSendDefaultConfig(current: MiniGameId[]): void {
    if (this.defaultConfigSent || !this.isHost() || current.length > 0) return
    this.defaultConfigSent = true
    this.configure(MINIGAMES.map((g) => g.id))
  }

  // ── Intents ────────────────────────────────────────────────────────────────────────────────────
  // No-repeat sessions play each selected game at most once, so the round count follows the selection
  // size whenever the line-up changes (picking a game adds a round, dropping one removes it).
  private configure(ids: MiniGameId[], rounds = ids.length, handicap?: boolean): void {
    if (!this.isHost()) return
    this.net.send({
      type: 'HOST_CONFIG',
      minigameIds: ids,
      rounds: Math.max(1, rounds),
      ...(handicap === undefined ? {} : { handicap }),
    })
  }

  isSelected(id: MiniGameId): boolean {
    return this.selectedGameIds().includes(id)
  }

  toggleGame(id: MiniGameId): void {
    const current = this.selectedGameIds()
    this.configure(this.isSelected(id) ? current.filter((g) => g !== id) : [...current, id])
  }

  selectGames(ids: readonly MiniGameId[]): void {
    this.configure([...new Set([...this.selectedGameIds(), ...ids])])
  }

  deselectGames(ids: readonly MiniGameId[]): void {
    const drop = new Set(ids)
    this.configure(this.selectedGameIds().filter((g) => !drop.has(g)))
  }

  // Mirrors the server's gameFitsRoom: the connected headcount is inside the game's player range and,
  // once teams are dealt, a team game has someone on each side.
  fits(id: MiniGameId): boolean {
    if (!fitsPlayers(id, this.connectedCount())) return false
    if (MINIGAMES_BY_ID.get(id)?.format !== 'team' || !this.usesTeams()) return true
    return this.teamSizes().every((n) => n > 0)
  }

  setRounds(value: number): void {
    const max = Math.max(1, this.playableGameIds().length)
    this.configure(this.selectedGameIds(), Math.max(1, Math.min(max, Math.round(value) || 1)))
  }

  toggleHandicap(on: boolean): void {
    this.configure(this.selectedGameIds(), this.rounds() || this.selectedGameIds().length, on)
  }

  toggleReady(): void {
    this.net.send({ type: 'SET_READY', ready: !this.myReady() })
  }

  start(): void {
    this.net.send({ type: 'START_SESSION' })
  }

  playAgain(): void {
    if (this.isHost()) this.net.send({ type: 'PLAY_AGAIN' })
  }

  makeHost(id: string): void {
    if (this.isHost() && id !== this.selfId())
      this.net.send({ type: 'TRANSFER_HOST', playerId: id })
  }

  kick(id: string): void {
    if (this.isHost() && id !== this.selfId()) this.net.send({ type: 'KICK_PLAYER', playerId: id })
  }

  swapTeam(p: PlayerDto): void {
    if (!this.isHost() || !p.team) return
    this.net.send({ type: 'SET_TEAM', playerId: p.id, team: p.team === 'red' ? 'blue' : 'red' })
  }

  shuffleTeams(): void {
    if (this.isHost()) this.net.send({ type: 'SHUFFLE_TEAMS' })
  }

  // Host escape hatch: abandon the current round (intro or game) unscored, e.g. when a game bugs out.
  skipRound(): void {
    if (this.isHost()) this.net.send({ type: 'SKIP_ROUND' })
  }

  private showNotice(text: string): void {
    clearTimeout(this.noticeTimer)
    this.notice.set(text)
    this.noticeTimer = setTimeout(() => this.notice.set(''), 4000)
  }

  // ── Lookups used by the view templates ─────────────────────────────────────────────────────────
  private player(id: string): PlayerDto | undefined {
    return this.players().find((p) => p.id === id)
  }

  playerName(id: string): string {
    return this.player(id)?.name ?? id.slice(0, 6)
  }

  playerColor(id: string): string {
    return this.player(id)?.color ?? NEUTRAL
  }

  playerAvatar(id: string): AvatarId {
    return (this.player(id)?.avatar as AvatarId) ?? 'cat'
  }

  teamColor(team: TeamId): string {
    return TEAMS.find((t) => t.id === team)?.color ?? NEUTRAL
  }

  teamName(team: TeamId): string {
    return this.transloco.translate(`team.${team}`)
  }

  gameName(id: string): string {
    return this.catalog.minigameName(id)
  }

  // Game-specific performance detail for a player on the round-result screen (e.g. "142 ms").
  roundStat(id: string): string {
    const stat = this.roundResult()?.result.stats?.[id] ?? ''
    return stat ? localizeStat(stat, this.transloco.translateObject('room.stat') ?? {}) : ''
  }

  // Catch-up bonus points a player earned this round (0 = none / handicap off).
  roundHandicap(id: string): number {
    return this.roundResult()?.result.handicap?.[id] ?? 0
  }

  // Points a player gained in the just-finished round (for the "+N" next to the running total).
  roundPoints(id: string): number {
    return this.roundResult()?.result.scores.find((s) => s.playerId === id)?.points ?? 0
  }

  calloutFor(id: string): string {
    return this.roundCallouts()[id] ?? ''
  }

  // Session rank movement since the previous round's standings: positive = climbed, negative =
  // dropped, 0 = unchanged or no prior standings (round 1).
  rankDelta(id: string): number {
    const prev = this.previousScoreboard().find((s) => s.playerId === id)?.rank
    const cur = this.scoreboard().find((s) => s.playerId === id)?.rank
    if (prev === undefined || cur === undefined) return 0
    return prev - cur
  }

  // Whether this client won the round (FFA: first placement; team: member of the winning team).
  private isRoundWinner(result: RoundResultDto): boolean {
    const self = this.selfId()
    const team = result.teams?.find((t) => t.rank === 0)
    return team ? team.memberIds.includes(self) : result.placements[0] === self
  }

  // Cosmetic flavor text for the just-finished round, purely for laughs — never affects scoring. Tiers:
  // a multi-round winning streak beats a plain win, the round's last place gets razzed, everyone else
  // gets a neutral line. One pick per player per round (memoized in `roundCallouts`), seeded by the
  // round and the player, so every screen in the room razzes the loser with the same line.
  private buildCallouts(result: RoundResultDto, round: number): Record<string, string> {
    const winnerId = result.placements[0] ?? null
    for (const id of this.players().map((p) => p.id)) {
      const streak = id === winnerId ? (this.winStreak.get(id) ?? 0) + 1 : 0
      this.winStreak.set(id, streak)
    }
    const ranks = result.scores.map((s) => s.rank)
    const lastRank = Math.max(...ranks)
    // A full tie has no last place to razz.
    const allTied = lastRank === Math.min(...ranks)
    const callouts: Record<string, string> = {}
    for (const s of result.scores) {
      const tier =
        s.playerId === winnerId && (this.winStreak.get(s.playerId) ?? 0) >= 2
          ? 'streak'
          : s.playerId === winnerId
            ? 'winner'
            : s.rank === lastRank && !allTied
              ? 'loser'
              : 'other'
      const options = linesOf(this.transloco.translate<unknown>(`room.result.callout.${tier}`))
      callouts[s.playerId] = pickLine(options, `${round}:${result.minigameId}:${s.playerId}`)
    }
    return callouts
  }
}
