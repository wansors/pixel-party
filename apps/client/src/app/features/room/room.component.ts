import { Component, DestroyRef, NgZone, type OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import {
  AVATARS,
  type AvatarId,
  MINIGAMES,
  type MiniGameId,
  type MiniGameMeta,
  PLAYER_COLORS,
  type PlayerDto,
  type RoundResultDto,
  type ScoreEntryDto,
  type ServerMsg,
} from '@pp/shared'
import { GameClient } from '../../../game/GameClient'
import { AudioService } from '../../core/audio/audio.service'
import { GameSocketService } from '../../core/net/game-socket.service'
import { AudioControlsComponent } from '../../shared/audio-controls.component'
import { PixelAvatarComponent } from '../../shared/pixel-avatar.component'

type View = 'connecting' | 'lobby' | 'intro' | 'round' | 'round-result' | 'scoreboard' | 'final'

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T

// Single feature component driving the whole room lifecycle from server messages: lobby -> intro ->
// round (Phaser canvas) -> scoreboard -> final. Angular owns the DOM/chrome; the round canvas is owned
// by GameClient (Phaser), booted inside runOutsideAngular so its rAF never drives change detection.
@Component({
  selector: 'app-room',
  imports: [PixelAvatarComponent, AudioControlsComponent],
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

  readonly copied = signal(false)
  readonly intro = signal<{ round: number; total: number; game: string } | null>(null)
  readonly countdown = signal<number | null>(null)
  readonly roundResult = signal<{ round: number; result: RoundResultDto } | null>(null)
  readonly scoreboard = signal<ScoreEntryDto[]>([])
  readonly final = signal<ScoreEntryDto[]>([])

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
        this.maybeSendDefaultConfig(msg.minigameIds)
        if (this.view() === 'connecting' || this.view() === 'lobby') this.view.set('lobby')
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
        this.view.set('final')
        this.game?.destroy()
        this.game = undefined
        break
      case 'JOIN_REJECTED':
        this.message.set(`Join rejected: ${msg.reason}`)
        break
      case 'ACK':
        // A refused REJOIN means the seat is gone — clear it and join fresh.
        if (msg.intent === 'REJOIN' && !msg.ok) {
          sessionStorage.removeItem(this.pidKey())
          this.net.resetIdentity()
          this.net.send({ type: 'JOIN', name: this.name, color: this.color, avatar: this.avatar })
          break
        }
        if (!msg.ok) this.message.set(`${msg.intent} rejected: ${msg.reason ?? ''}`)
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
    this.game = new GameClient((m) => this.net.send(m), this.audio.sfx)
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

  isSelected(id: MiniGameId): boolean {
    return this.selectedGameIds().includes(id)
  }

  toggleGame(id: MiniGameId): void {
    if (!this.isHost()) return
    const next = this.isSelected(id)
      ? this.selectedGameIds().filter((g) => g !== id)
      : [...this.selectedGameIds(), id]
    this.net.send({ type: 'HOST_CONFIG', minigameIds: next, rounds: this.rounds() || next.length })
  }

  setRounds(value: string): void {
    if (!this.isHost()) return
    const n = Math.max(1, Math.min(20, Number(value) || 1))
    this.net.send({ type: 'HOST_CONFIG', minigameIds: this.selectedGameIds(), rounds: n })
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

  gameName(id: string): string {
    return this.availableGames.find((g) => g.id === id)?.name ?? id
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
}
