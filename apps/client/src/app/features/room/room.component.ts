import { Component, DestroyRef, NgZone, type OnInit, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import {
  AVATARS,
  AXIS_COLORS,
  type AvatarId,
  MINIGAMES,
  type MiniGameId,
  type MiniGameMeta,
  PLAYER_COLORS,
  type PlayerDto,
  type PlayerRadarDto,
  type RoundResultDto,
  SKILL_AXES,
  type ScoreEntryDto,
  type ServerMsg,
  type SessionSummaryDto,
  type SkillAxis,
  TEAMS,
  type TeamId,
  type TeamRoundResult,
} from '@pp/shared'
import { GameClient } from '../../../game/GameClient'
import { AudioService } from '../../core/audio/audio.service'
import { CatalogI18nService } from '../../core/i18n/catalog-i18n.service'
import { GameSocketService } from '../../core/net/game-socket.service'
import { AudioControlsComponent } from '../../shared/audio-controls.component'
import { LanguageToggleComponent } from '../../shared/language-toggle.component'
import { PixelAvatarComponent } from '../../shared/pixel-avatar.component'
import { type RadarAxis, SkillRadarComponent } from '../../shared/skill-radar.component'

type View = 'connecting' | 'lobby' | 'intro' | 'round' | 'round-result' | 'scoreboard' | 'final'

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T

// Single feature component driving the whole room lifecycle from server messages: lobby -> intro ->
// round (Phaser canvas) -> scoreboard -> final. Angular owns the DOM/chrome; the round canvas is owned
// by GameClient (Phaser), booted inside runOutsideAngular so its rAF never drives change detection.
@Component({
  selector: 'app-room',
  imports: [
    PixelAvatarComponent,
    SkillRadarComponent,
    AudioControlsComponent,
    LanguageToggleComponent,
    TranslocoPipe,
  ],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent implements OnInit {
  private readonly net = inject(GameSocketService)
  private readonly audio = inject(AudioService)
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly zone = inject(NgZone)
  private readonly destroyRef = inject(DestroyRef)
  private readonly transloco = inject(TranslocoService)
  readonly catalog = inject(CatalogI18nService)

  readonly availableGames: readonly MiniGameMeta[] = MINIGAMES

  readonly code = signal('')
  readonly view = signal<View>('connecting')
  readonly players = signal<PlayerDto[]>([])
  readonly hostId = signal('')
  readonly selfId = signal('')
  readonly isHost = signal(false)
  readonly reconnecting = signal(false)
  readonly message = signal('')

  // Host session config (mirrors LOBBY_STATE so everyone sees the current selection).
  readonly selectedGameIds = signal<MiniGameId[]>([])
  readonly rounds = signal(0)
  // True when the line-up includes a team game — the lobby then shows team assignment.
  readonly usesTeams = signal(false)
  // Bounded scoring catch-up toggle (Phase 3), mirrored from LOBBY_STATE.
  readonly handicap = signal(false)
  // Game-selector axis filter (client-only UI state, not mirrored to the server): null = show every
  // game; a SkillAxis narrows the grid to games tagged with it, so a host can build a themed line-up.
  readonly axisFilter = signal<SkillAxis | null>(null)

  readonly copied = signal(false)
  readonly intro = signal<{ round: number; total: number; game: string } | null>(null)
  readonly countdown = signal<number | null>(null)
  readonly roundResult = signal<{ round: number; result: RoundResultDto } | null>(null)
  readonly scoreboard = signal<ScoreEntryDto[]>([])
  readonly final = signal<ScoreEntryDto[]>([])
  // Phase 4 post-match analysis (present on FINAL_RANKING).
  readonly radars = signal<PlayerRadarDto[]>([])
  readonly summary = signal<SessionSummaryDto | null>(null)

  private game?: GameClient
  private currentGame?: MiniGameId
  private defaultConfigSent = false
  private countdownTimer?: ReturnType<typeof setInterval>
  private name = ''
  private color: string = pick(PLAYER_COLORS)
  private avatar: AvatarId = pick(AVATARS)

  get myReady(): boolean {
    return this.players().find((p) => p.id === this.selfId())?.ready ?? false
  }

  private pidKey(): string {
    return `pp:pid:${this.code()}`
  }

  ngOnInit(): void {
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase()
    const q = this.route.snapshot.queryParamMap
    this.name = q.get('name')?.trim() || `Player-${pick(AVATARS)}`
    const qColor = q.get('color')
    if (qColor && PLAYER_COLORS.includes(qColor)) this.color = qColor
    const qAvatar = q.get('avatar')
    if (qAvatar && (AVATARS as readonly string[]).includes(qAvatar))
      this.avatar = qAvatar as AvatarId
    if (!code) {
      this.router.navigate(['/'])
      return
    }
    this.code.set(code)
    this.audio.ensureMusic()

    // A seat id persisted from an earlier connection lets a page reload / socket drop rejoin in place.
    const storedId = sessionStorage.getItem(this.pidKey())
    if (storedId) this.net.restoreIdentity(storedId)

    this.net.connected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((up) => {
      if (!up) return
      // With a known id this is a reconnect → reclaim the seat; otherwise it is a first-time join.
      if (this.net.playerId) this.net.send({ type: 'REJOIN', playerId: this.net.playerId })
      else this.net.send({ type: 'JOIN', name: this.name, color: this.color, avatar: this.avatar })
    })
    this.net.reconnecting$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.reconnecting.set(r))
    this.net.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((m) => this.handle(m))

    this.zone.runOutsideAngular(() => this.net.connect(code))
    this.destroyRef.onDestroy(() => {
      this.clearCountdown()
      this.game?.destroy()
      this.net.disconnect()
    })
  }

  private handle(msg: ServerMsg): void {
    switch (msg.type) {
      case 'WELCOME':
        this.selfId.set(msg.playerId)
        this.isHost.set(msg.isHost)
        sessionStorage.setItem(this.pidKey(), msg.playerId)
        if (this.game) this.game.state.selfId = msg.playerId
        break
      case 'LOBBY_STATE':
        this.players.set(msg.players)
        this.hostId.set(msg.hostId)
        this.isHost.set(msg.hostId === this.selfId())
        this.selectedGameIds.set(msg.minigameIds)
        this.rounds.set(msg.rounds)
        this.usesTeams.set(msg.usesTeams)
        this.handicap.set(msg.handicap)
        this.maybeSendDefaultConfig(msg.minigameIds)
        // Keyed off the server's phase (not the current view): a LOBBY_STATE broadcast during an active
        // round (e.g. another player reconnecting) always carries that round's phase, so it never snaps
        // an in-round client back to the lobby — only a genuine lobby phase does, which also covers the
        // final -> lobby transition after PLAY_AGAIN.
        if (msg.phase === 'lobby') this.view.set('lobby')
        break
      case 'ROUND_INTRO':
        this.currentGame = msg.minigameId
        this.intro.set({ round: msg.round, total: msg.totalRounds, game: msg.minigameId })
        this.startCountdown(msg.startsInMs)
        this.view.set('intro')
        break
      case 'ROUND_STATE': {
        this.clearCountdown()
        const entering = this.view() !== 'round'
        if (entering) this.view.set('round')
        this.ensureGame()
        if (this.currentGame) this.game?.startRound(this.currentGame)
        // The container was display:none until this view change; RESIZE mode only reacts to window
        // resizes, so force a measure once the section is visible again.
        if (entering) this.zone.runOutsideAngular(() => setTimeout(() => this.game?.refresh(), 0))
        this.game?.handle(msg)
        break
      }
      case 'ROUND_RESULT':
        this.roundResult.set({ round: msg.round, result: msg.result })
        this.radars.set(msg.result.radars ?? [])
        this.view.set('round-result')
        this.audio.sfx.coin()
        break
      case 'SCOREBOARD':
        this.scoreboard.set(msg.scores)
        // The cumulative board follows the round-result reveal; don't clobber intro/round/final on a
        // reconnect, where SCOREBOARD is only seeding scores.
        if (this.view() === 'round-result') this.view.set('scoreboard')
        break
      case 'FINAL_RANKING':
        this.final.set(msg.scores)
        this.radars.set(msg.radars ?? [])
        this.summary.set(msg.summary ?? null)
        this.view.set('final')
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
          this.net.send({ type: 'JOIN', name: this.name, color: this.color, avatar: this.avatar })
          break
        }
        if (!msg.ok)
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

  // Boot Phaser lazily once the round container is in the DOM, outside the Angular zone.
  private ensureGame(): void {
    if (this.game) return
    this.game = new GameClient(
      (m) => this.net.send(m),
      this.audio.sfx,
      (k, p) => this.transloco.translate(k, p),
    )
    if (this.selfId()) this.game.state.selfId = this.selfId()
    this.zone.runOutsideAngular(() => {
      setTimeout(() => this.game?.boot('game-container'), 0)
    })
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
    const ids = this.availableGames.map((g) => g.id)
    this.net.send({ type: 'HOST_CONFIG', minigameIds: ids, rounds: ids.length })
  }

  // Games shown in the picker grid, narrowed by the active axis filter chip (if any).
  readonly filteredGames = computed(() => {
    const axis = this.axisFilter()
    return axis ? this.availableGames.filter((g) => g.axes.includes(axis)) : this.availableGames
  })

  // Aggregate skill coverage of the current line-up, as a 0..1 radar per axis (relative to whichever
  // axis the selection leans on most) — a "what will this session train" preview, not a performance
  // score. Empty selection means the radar has nothing to draw; the template hides it in that case.
  readonly selectionCoverage = computed(() => {
    const ids = new Set(this.selectedGameIds())
    const counts = new Map<SkillAxis, number>()
    for (const g of this.availableGames) {
      if (!ids.has(g.id)) continue
      for (const axis of g.axes) counts.set(axis, (counts.get(axis) ?? 0) + 1)
    }
    const max = Math.max(1, ...counts.values())
    return SKILL_AXES.map((axis) => ({
      label: this.catalog.axisLabel(axis),
      value: (counts.get(axis) ?? 0) / max,
    }))
  })

  readonly skillAxes = SKILL_AXES

  axisColor(axis: SkillAxis): string {
    return AXIS_COLORS[axis]
  }

  toggleAxisFilter(axis: SkillAxis): void {
    this.axisFilter.set(this.axisFilter() === axis ? null : axis)
  }

  isSelected(id: MiniGameId): boolean {
    return this.selectedGameIds().includes(id)
  }

  toggleGame(id: MiniGameId): void {
    if (!this.isHost()) return
    const next = this.isSelected(id)
      ? this.selectedGameIds().filter((g) => g !== id)
      : [...this.selectedGameIds(), id]
    // No-repeat sessions play each selected game at most once, so rounds tracks the selection size by
    // default — picking a game adds a round, dropping one removes it. `||` here would have kept
    // whatever round count was already set (truthy from the very first default config) and silently
    // stopped following the selection; the server-side clamp then only ever capped it down, never back
    // up, so growing the line-up after shrinking it looked like rounds was "stuck".
    this.net.send({ type: 'HOST_CONFIG', minigameIds: next, rounds: next.length })
  }

  selectAllGames(): void {
    if (!this.isHost()) return
    const ids = this.availableGames.map((g) => g.id)
    this.net.send({ type: 'HOST_CONFIG', minigameIds: ids, rounds: ids.length })
  }

  deselectAllGames(): void {
    if (!this.isHost()) return
    this.net.send({ type: 'HOST_CONFIG', minigameIds: [], rounds: 1 })
  }

  setRounds(value: string): void {
    if (!this.isHost()) return
    const n = Math.max(1, Math.min(20, Number(value) || 1))
    this.net.send({ type: 'HOST_CONFIG', minigameIds: this.selectedGameIds(), rounds: n })
  }

  toggleHandicap(on: boolean): void {
    if (!this.isHost()) return
    this.net.send({
      type: 'HOST_CONFIG',
      minigameIds: this.selectedGameIds(),
      rounds: this.rounds() || this.selectedGameIds().length,
      handicap: on,
    })
  }

  get inviteUrl(): string {
    return `${location.origin}/?code=${this.code()}`
  }

  // Clipboard API needs a secure context (localhost qualifies, plain LAN IPs don't) — fall back to
  // the legacy execCommand path so copying also works when the host opened the app via its LAN IP.
  async copyInvite(): Promise<void> {
    const url = this.inviteUrl
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    this.copied.set(true)
    setTimeout(() => this.copied.set(false), 2000)
  }

  toggleReady(): void {
    this.net.send({ type: 'SET_READY', ready: !this.myReady })
  }

  start(): void {
    this.net.send({ type: 'START_SESSION' })
  }

  playAgain(): void {
    if (!this.isHost()) return
    this.net.send({ type: 'PLAY_AGAIN' })
  }

  makeHost(id: string): void {
    if (!this.isHost() || id === this.selfId()) return
    this.net.send({ type: 'TRANSFER_HOST', playerId: id })
  }

  kick(id: string): void {
    if (!this.isHost() || id === this.selfId()) return
    this.net.send({ type: 'KICK_PLAYER', playerId: id })
  }

  // ── Teams ───────────────────────────────────────────────────────────────
  swapTeam(p: PlayerDto): void {
    if (!this.isHost() || !p.team) return
    this.net.send({ type: 'SET_TEAM', playerId: p.id, team: p.team === 'red' ? 'blue' : 'red' })
  }

  shuffleTeams(): void {
    if (!this.isHost()) return
    this.net.send({ type: 'SHUFFLE_TEAMS' })
  }

  teamColor(team: TeamId): string {
    return TEAMS.find((t) => t.id === team)?.color ?? '#7b88a8'
  }

  teamName(team: TeamId): string {
    return this.transloco.translate(`team.${team}`)
  }

  // Team ranking behind the current round result (empty for FFA rounds); rank 0 = winning team.
  resultTeams(): TeamRoundResult[] {
    return this.roundResult()?.result.teams ?? []
  }

  winningTeam(): TeamRoundResult | null {
    return this.resultTeams().find((t) => t.rank === 0) ?? null
  }

  gameName(id: string): string {
    return this.catalog.minigameName(id)
  }

  playerName(id: string): string {
    return this.players().find((p) => p.id === id)?.name ?? id.slice(0, 6)
  }

  playerColor(id: string): string {
    return this.players().find((p) => p.id === id)?.color ?? '#7b88a8'
  }

  playerAvatar(id: string): AvatarId {
    return (this.players().find((p) => p.id === id)?.avatar as AvatarId) ?? 'cat'
  }

  // Winner of the just-finished round = first in the placement ordering (empty if nobody scored).
  roundWinnerId(): string | null {
    return this.roundResult()?.result.placements[0] ?? null
  }

  // Game-specific performance detail for a player on the round-result screen (e.g. "142 ms").
  roundStat(id: string): string {
    return this.roundResult()?.result.stats?.[id] ?? ''
  }

  // Catch-up bonus points a player earned this round (0 = none / handicap off).
  roundHandicap(id: string): number {
    return this.roundResult()?.result.handicap?.[id] ?? 0
  }

  // ── Post-match analysis (Phase 4) ─────────────────────────────────────────
  // The viewing player's skill radar: ALL skill axes, in the shared axis order, labelled — axes not
  // played yet show as 0 rather than being dropped. A radar needs every axis as a vertex to read as a
  // proper shape; omitting unplayed ones shrinks it to too few points (as low as one early in a
  // session), which renders as a degenerate sliver instead of a filled hexagon.
  myRadar(): RadarAxis[] {
    const mine = this.radars().find((r) => r.playerId === this.selfId())
    if (!mine) return []
    return SKILL_AXES.map((axis) => ({
      label: this.catalog.axisLabel(axis),
      value: mine.axes[axis] ?? 0,
    }))
  }

  hasProfile(): boolean {
    const mine = this.radars().find((r) => r.playerId === this.selfId())
    return !!mine && Object.keys(mine.axes).length > 0
  }
}
