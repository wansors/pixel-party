import { Component, DestroyRef, NgZone, type OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import {
  MINIGAMES,
  type MiniGameId,
  type MiniGameMeta,
  type PlayerDto,
  type ScoreEntryDto,
  type ServerMsg,
} from '@pp/shared'
import { GameClient } from '../../../game/GameClient'
import { GameSocketService } from '../../core/net/game-socket.service'

type View = 'connecting' | 'lobby' | 'intro' | 'round' | 'scoreboard' | 'final'

const COLORS = [
  '#e63946',
  '#457b9d',
  '#2a9d8f',
  '#e9c46a',
  '#f4a261',
  '#8e7dbe',
  '#06d6a0',
  '#ef476f',
]
const AVATARS = ['cat', 'dog', 'fox', 'owl', 'frog', 'bear']
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T

// Single feature component driving the whole room lifecycle from server messages: lobby -> intro ->
// round (Phaser canvas) -> scoreboard -> final. Angular owns the DOM/chrome; the round canvas is owned
// by GameClient (Phaser), booted inside runOutsideAngular so its rAF never drives change detection.
@Component({
  selector: 'app-room',
  imports: [],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent implements OnInit {
  private readonly net = inject(GameSocketService)
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

  readonly intro = signal<{ round: number; total: number; game: string } | null>(null)
  readonly countdown = signal<number | null>(null)
  readonly scoreboard = signal<ScoreEntryDto[]>([])
  readonly final = signal<ScoreEntryDto[]>([])

  private game?: GameClient
  private currentGame?: MiniGameId
  private joined = false
  private defaultConfigSent = false
  private countdownTimer?: ReturnType<typeof setInterval>
  private name = ''
  private color = pick(COLORS)
  private avatar = pick(AVATARS)

  get myReady(): boolean {
    return this.players().find((p) => p.id === this.selfId())?.ready ?? false
  }

  ngOnInit(): void {
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase()
    this.name = this.route.snapshot.queryParamMap.get('name')?.trim() || `Player-${pick(AVATARS)}`
    if (!code) {
      this.router.navigate(['/'])
      return
    }
    this.code.set(code)

    this.net.connected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((up) => {
      if (up && !this.joined) {
        this.joined = true
        this.net.send({ type: 'JOIN', name: this.name, color: this.color, avatar: this.avatar })
      }
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
      case 'ROUND_STATE':
        this.clearCountdown()
        if (this.view() !== 'round') this.view.set('round')
        this.ensureGame()
        if (this.currentGame) this.game?.startRound(this.currentGame)
        this.game?.handle(msg)
        break
      case 'ROUND_RESULT':
        this.view.set('scoreboard')
        break
      case 'SCOREBOARD':
        this.scoreboard.set(msg.scores)
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
    this.game = new GameClient((m) => this.net.send(m))
    if (this.selfId()) this.game.state.selfId = this.selfId()
    this.zone.runOutsideAngular(() => {
      setTimeout(() => this.game?.boot('game-container'), 0)
    })
  }

  private startCountdown(startsInMs: number): void {
    this.clearCountdown()
    let n = Math.max(1, Math.ceil(startsInMs / 1000))
    this.countdown.set(n)
    this.countdownTimer = setInterval(() => {
      n -= 1
      this.countdown.set(n > 0 ? n : null)
      if (n <= 0) this.clearCountdown()
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
}
