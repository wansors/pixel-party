import type { ClientMsg, MiniGameId } from '@pp/shared'
import Phaser from 'phaser'
import { type AvatarWarmSpec, avatarWarmups } from '../avatars'
import { Hud } from '../hud'
import type { Translate } from '../i18n'
import { addArcadeBackdrop } from '../pixelStyle'
import { linesOf, pickLine } from '../quips'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

// Everything a scene needs from the outside world, in the order GameClient hands it over.
export type SceneDeps = readonly [
  send: (msg: ClientMsg) => void,
  state: RoundState,
  sfx: Sfx,
  t: Translate,
]

export type MiniGameSceneCtor = new (...deps: SceneDeps) => MiniGameScene<unknown>

// Resizes smaller than this (fraction of each side) are ignored. Height gets the larger allowance:
// mobile browsers nudge the viewport height whenever the URL bar collapses, and a relayout for that
// would only cause a visible hiccup.
const RELAYOUT_THRESHOLD_W = 0.03
const RELAYOUT_THRESHOLD_H = 0.12
const RELAYOUT_DEBOUNCE_MS = 250
// Keys whose browser default (button activation, slider nudge, page scroll) must not fire mid-round.
const GAME_KEYS = 'SPACE,ENTER,UP,DOWN,LEFT,RIGHT'
// Avatar textures generated per frame while warming (warmAvatars).
const WARM_PER_FRAME = 3

// Common base for every mini-game canvas. Scene key === mini-game id, so GameClient can start a round's
// scene by id. It owns the cross-cutting plumbing each scene used to repeat:
//
//  - `snap`: the authoritative snapshot, but ONLY when it belongs to this scene's game. A scene that is
//    still running when the next round's first ROUND_STATE lands must never try to read another game's
//    snapshot shape (that threw inside Phaser's step and froze the canvas for the rest of the session).
//  - a crash guard around the per-frame hook, so one bad frame logs once instead of killing the loop;
//  - the arcade backdrop and the standard HUD (score chip + draining time bar, fed automatically);
//  - the FINISH moment when the server flags the round's final (frozen) snapshot;
//  - relayout on a real viewport change (orientation flip, window resize): layouts are computed in
//    create(), so the scene simply restarts — every scene rebuilds its round state from the snapshot.
//
// Subclasses implement create() (layout + input wiring; call super.create() first) and frame().
export abstract class MiniGameScene<S> extends Phaser.Scene {
  protected readonly send: (msg: ClientMsg) => void
  protected readonly state: RoundState
  protected readonly sfx: Sfx
  protected readonly t: Translate
  protected hud?: Hud
  private reportedError = false
  private finishShown = false
  private seenSnapshot = false
  // True during the frame that receives this scene's first snapshot since create() — a fresh round, or
  // a relayout restart mid-round. Scenes prime their "last seen" trackers from it instead of playing
  // delta feedback (a restart must not replay "+12", a pop, or a win fanfare).
  protected firstSnapshot = false
  private laidOutAt = { w: 0, h: 0 }
  // Texture work queued by warmAvatars(), drained a few items per frame.
  private warmQueue: (() => void)[] = []
  private relayoutTimer?: Phaser.Time.TimerEvent

  constructor(
    readonly gameId: MiniGameId,
    ...[send, state, sfx, t]: SceneDeps
  ) {
    super(gameId)
    this.send = send
    this.state = state
    this.sfx = sfx
    this.t = t
  }

  // Phaser lifecycle: runs before every create() (scene instances survive stop/start across rounds).
  init(): void {
    this.reportedError = false
    this.finishShown = false
    this.seenSnapshot = false
    this.firstSnapshot = false
    this.hud = undefined
    this.warmQueue = []
    this.laidOutAt = { w: this.scale.width, h: this.scale.height }
    this.scale.on('resize', this.onResize, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this)
      this.relayoutTimer = undefined
    })
  }

  // Base layout: backdrop + the standard HUD. Scenes call super.create() first and lay out below
  // `this.top`. Pass `hud: false` for scenes that own the whole canvas (e.g. full-bleed Reaction).
  create(opts: { hud?: boolean } = {}): void {
    addArcadeBackdrop(this)
    if (opts.hud !== false) this.hud = new Hud(this, this.sfx)
    this.claimGameKeys()
  }

  // The game keys belong to the game while it runs. A page control left focused (the sound toggle, a
  // volume slider clicked between rounds or mid-round) would otherwise also take Space/Enter/arrows —
  // toggling the music or sliding the volume while the player steers. Capturing them stops the
  // browser's default; the scene's own handlers still fire.
  private claimGameKeys(): void {
    const keyboard = this.input.keyboard
    if (!keyboard) return
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    keyboard.addCapture(GAME_KEYS)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.removeCapture(GAME_KEYS))
  }

  // First y coordinate free for scene content (below the HUD strip, or the top edge without one).
  protected get top(): number {
    return this.hud?.bottom ?? 0
  }

  // The current snapshot if (and only if) it belongs to this game — null otherwise.
  protected get snap(): S | null {
    if (this.state.minigameId !== this.gameId) return null
    return (this.state.state as S | null) ?? null
  }

  protected get selfId(): string {
    return this.state.selfId ?? ''
  }

  // Display label for a player: "YOU" for this client, else their roster name.
  protected label(id: string): string {
    return id === this.selfId ? this.t('game.common.you') : this.state.nameOf(id)
  }

  // A flavor line from an i18n pool (game/quips): the same on every client for the same seed — pass
  // the player id or the moment it reacts to — and stable from frame to frame.
  protected quip(key: string, seed: string): string {
    return pickLine(linesOf(this.t(key)), `${this.gameId}:${seed}`)
  }

  // Keyboard binding that ignores the OS key auto-repeat by default: a held key would otherwise fire
  // ~30 inputs/s (an auto-masher, auto-jumper, hard-drop storm). Pass `{ repeat: true }` where holding
  // is meant to repeat (cursor/aim nudges, Tetris left/right, maze moves).
  protected onKey(key: string, handler: () => void, opts: { repeat?: boolean } = {}): void {
    this.input.keyboard?.on(`keydown-${key}`, (e: KeyboardEvent) => {
      if (e.repeat && !opts.repeat) return
      handler()
    })
  }

  // Pre-generates the avatar textures a round will need (poses, faces, stride frames) a few per frame,
  // instead of all at once the first time someone trips, walks or cheers mid-round — with 12 players
  // that's a visible hitch. Call it once the roster is known (the first snapshot).
  protected warmAvatars(ids: readonly string[], specs: readonly AvatarWarmSpec[]): void {
    const looks = ids.map((id) => ({
      avatar: this.state.avatarOf(id),
      color: this.state.colorOf(id),
    }))
    this.warmQueue.push(...avatarWarmups(this, looks, specs))
  }

  protected sendInput(input: Record<string, unknown>): void {
    this.send({ type: 'MINIGAME_INPUT', input })
  }

  // Round clock read by the HUD every frame. Most snapshots expose `remainingMs`; scenes whose snapshot
  // names it differently (or has no clock) override this.
  protected remainingMs(snap: S): number | null {
    const ms = (snap as { remainingMs?: unknown }).remainingMs
    return typeof ms === 'number' ? ms : null
  }

  // Per-frame hook (Phaser's update, crash-guarded). `snap` is this game's snapshot or null.
  protected abstract frame(snap: S | null, time: number, delta: number): void

  override update(time: number, delta: number): void {
    for (let k = 0; k < WARM_PER_FRAME && this.warmQueue.length > 0; k++) this.warmQueue.pop()?.()
    try {
      const snap = this.snap
      this.firstSnapshot = snap !== null && !this.seenSnapshot
      if (snap) this.seenSnapshot = true
      if (this.hud && snap) this.hud.setRemaining(this.remainingMs(snap))
      this.frame(snap, time, delta)
      if (snap && this.state.final && !this.finishShown) this.onRoundFinished()
    } catch (err) {
      if (!this.reportedError) {
        this.reportedError = true
        console.error(`[${this.gameId}] frame failed`, err)
      }
    }
  }

  // The server flagged the round's last snapshot: a short FINISH moment (whistle + HUD stamp) while
  // the final state stays fully visible until the results arrive.
  private onRoundFinished(): void {
    this.finishShown = true
    this.sfx.go()
    this.hud?.showFinish(this.t('game.common.finish'))
  }

  private onResize(size: Phaser.Structs.Size): void {
    const dw = Math.abs(size.width - this.laidOutAt.w) / Math.max(1, this.laidOutAt.w)
    const dh = Math.abs(size.height - this.laidOutAt.h) / Math.max(1, this.laidOutAt.h)
    if (dw < RELAYOUT_THRESHOLD_W && dh < RELAYOUT_THRESHOLD_H) return
    this.relayoutTimer?.remove()
    this.relayoutTimer = this.time.delayedCall(RELAYOUT_DEBOUNCE_MS, () => this.scene.restart())
  }
}
