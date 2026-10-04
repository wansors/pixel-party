import { MARBLES, type MarblesPlayerView, type MarblesSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { type AvatarExpression, AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, floatText, punch, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelOrb,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'
import { type DuelSeat, DuelWatch, verdictKey } from './duelWatch'

// Marbles Duel (odd or even): your rival across the table at the top, you at the bottom, each with your
// lobby avatar and your pouch of marbles. When you HIDE, pick how many go in your fist (− / +, then
// HIDE); when you GUESS, pick a bet (− / +) and call ODD or EVEN. Both choose at once; the reveal opens
// the fist and rolls the marbles to the winner. Keys: type the number (1–9, 0 = 10, two digits for
// more) or nudge it with ←/→ ↑/↓ (A/D W/S); SPACE / ENTER hides; O or N calls odd (nones), E or P
// even (pares). The bye (or a player who joined mid-round) watches another duel from the same seat,
// read-only — and so does a duellist a few seconds after their own duel is over.

// A second digit typed this soon after the first makes a two-digit number ("1", "5" = 15).
const DIGIT_CHAIN_MS = 900

const MARBLE_COLORS = [
  PALETTE.cyan,
  PALETTE.magenta,
  PALETTE.amber,
  PALETTE.lime,
  PALETTE.orange,
  0xb06bff,
]

// The duels as a spectator picks them (a marbles duel is over once its phase says so).
function seats(snap: MarblesSnapshot): Record<string, DuelSeat> {
  const out: Record<string, DuelSeat> = {}
  for (const [id, v] of Object.entries(snap.players)) {
    out[id] = { opponentId: v.opponentId, done: v.phase === 'done' }
  }
  return out
}

export class MarblesDuelScene extends MiniGameScene<MarblesSnapshot> {
  private compact = false
  private pick = 1
  private ui: Phaser.GameObjects.GameObject[] = []
  private pickText?: Phaser.GameObjects.Text
  private prompt?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private table?: Phaser.GameObjects.Graphics
  private timer?: Phaser.GameObjects.Graphics
  private pouches?: Phaser.GameObjects.Graphics
  private mineText?: Phaser.GameObjects.Text
  private theirsText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private layoutKey = ''
  private lastView?: MarblesPlayerView
  private myAvatar?: AvatarSprite
  private rivalAvatar?: AvatarSprite
  private rows = { theirs: 0, mine: 0, centre: 0, controls: 0 }
  private revealShown = 0
  private readonly watch = new DuelWatch()
  // Whose seat the table is drawn from: yours while you play, else the duellist being watched.
  private viewId: string | null | undefined = undefined
  private playing = false
  private hint?: Phaser.GameObjects.Text
  private big = false
  // The turn we already committed a choice for (the controls go at once, before the snapshot says so).
  private committedTurn = -1
  private lastDigit = { d: -1, at: 0 }
  private pouchKey = ''

  constructor(...deps: SceneDeps) {
    super('marbles-duel', ...deps)
  }

  protected override remainingMs(snap: MarblesSnapshot): number {
    return snap.roundRemainingMs
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.big = Math.min(width, height) >= 900
    this.pick = 1
    this.ui = []
    this.layoutKey = ''
    this.committedTurn = -1
    this.lastDigit = { d: -1, at: 0 }
    this.pouchKey = ''
    this.lastView = undefined
    this.myAvatar = undefined
    this.rivalAvatar = undefined
    this.revealShown = 0
    this.watch.reset()
    this.viewId = undefined
    this.playing = false
    // The key hint sits under the controls (not on phones: no keyboard there).
    const hintSize = this.big ? 16 : 14
    this.hint = this.compact
      ? undefined
      : this.add
          .text(
            width / 2,
            height - 8,
            this.t('game.marbles.keys'),
            bodyStyle(hintSize, PALETTE.dim),
          )
          .setOrigin(0.5, 1)
          .setDepth(10)
    const top = this.top + 10
    const bottom = height - 12 - (this.hint ? hintSize + 8 : 0)
    const h = bottom - top
    this.rows = {
      theirs: top + h * 0.1,
      centre: top + h * 0.42,
      mine: top + h * 0.7,
      controls: top + h * 0.88,
    }
    this.table = this.add.graphics().setDepth(1)
    this.table.fillStyle(0x3b2a20, 1).fillRoundedRect(16, top + h * 0.22, width - 32, h * 0.38, 12)
    this.table
      .fillStyle(0x4a3528, 1)
      .fillRoundedRect(22, top + h * 0.22 + 6, width - 44, h * 0.38 - 12, 10)
    this.pouches = this.add.graphics().setDepth(5)
    this.timer = this.add.graphics().setDepth(6)
    const size = this.compact ? 12 : this.big ? 24 : 16
    this.theirsText = this.add
      .text(width / 2, this.rows.theirs, '', headlineStyle(size, PALETTE.text))
      .setOrigin(0.5)
      .setDepth(10)
    this.mineText = this.add
      .text(
        width / 2,
        this.rows.mine + (this.compact ? 34 : this.big ? 52 : 40),
        '',
        headlineStyle(size, PALETTE.amber),
      )
      .setOrigin(0.5)
      .setDepth(10)
    this.prompt = this.add
      .text(
        width / 2,
        this.rows.centre - (this.compact ? 34 : 44),
        '',
        headlineStyle(size, PALETTE.amber),
      )
      .setOrigin(0.5)
      .setDepth(10)
    this.status = this.add
      .text(
        width / 2,
        this.rows.centre + (this.compact ? 40 : 52),
        '',
        bodyStyle(this.compact ? 12 : this.big ? 20 : 14, PALETTE.dim, {
          align: 'center',
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5)
      .setDepth(10)
    this.banner = addBanner(this)
    for (const key of ['LEFT', 'DOWN', 'A', 'S'])
      this.onKey(key, () => this.step(-1), { repeat: true })
    for (const key of ['RIGHT', 'UP', 'D', 'W'])
      this.onKey(key, () => this.step(1), { repeat: true })
    this.onKey('SPACE', () => this.commit('hide'))
    this.onKey('ENTER', () => this.commit('hide'))
    // Odd / even in both languages' initials: O·N (odd, nones), E·P (even, pares).
    for (const key of ['O', 'N']) this.onKey(key, () => this.commit('odd'))
    for (const key of ['E', 'P']) this.onKey(key, () => this.commit('even'))
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (!e.repeat && /^[0-9]$/.test(e.key)) this.typeDigit(Number(e.key))
    })
  }

  // A typed number: one digit (0 = 10), or two typed in quick succession.
  private typeDigit(d: number): void {
    const v = this.view()
    if (!this.canChoose(v)) return
    const now = this.time.now
    const chained = this.lastDigit.d * 10 + d
    const n =
      this.lastDigit.d > 0 && now - this.lastDigit.at < DIGIT_CHAIN_MS && chained <= v.mine
        ? chained
        : d === 0
          ? 10
          : d
    this.lastDigit = { d, at: now }
    this.setPick(n, v.mine)
  }

  private canChoose(v: MarblesPlayerView | undefined): v is MarblesPlayerView {
    return (
      this.playing &&
      !!v?.opponentId &&
      v.phase === 'choose' &&
      !v.youChose &&
      this.committedTurn !== v.turn &&
      !this.state.final
    )
  }

  private view(): MarblesPlayerView | undefined {
    return this.snap?.players[this.selfId]
  }

  private step(d: number): void {
    const v = this.view()
    if (!this.canChoose(v)) return
    this.lastDigit = { d: -1, at: 0 }
    this.setPick(this.pick + d, v.mine)
  }

  private setPick(n: number, max: number): void {
    this.pick = Math.max(1, Math.min(max, n))
    this.pickText?.setText(String(this.pick))
    if (this.pickText) punch(this, this.pickText, 0.15, 60)
    this.sfx.click()
  }

  private commit(what: 'hide' | 'odd' | 'even'): void {
    const v = this.view()
    if (!this.canChoose(v)) return
    if (what === 'hide' && v.role === 'hide') this.sendInput({ kind: 'hide', count: this.pick })
    else if (what !== 'hide' && v.role === 'guess')
      this.sendInput({ kind: 'guess', bet: this.pick, odd: what === 'odd' })
    else return
    // The fist closes on the pick (or the bet goes down): locked in.
    this.sfx.lock()
    // Locked in: the controls go now and the line says who we wait for (the snapshot catches up).
    this.committedTurn = v.turn
    this.buildControls(v)
    if (v.opponentId) {
      this.status?.setText(this.t('game.marbles.waiting', { name: this.label(v.opponentId) }))
    }
  }

  // Rebuilds the controls for the current role (hide: − n + HIDE · guess: − n + ODD EVEN).
  private buildControls(v: MarblesPlayerView): void {
    for (const o of this.ui) o.destroy()
    this.ui = []
    if (!this.canChoose(v)) {
      this.pickText = undefined
      return
    }
    const { width } = this.scale
    const y = this.rows.controls
    const bh = this.compact ? 56 : this.big ? 64 : 52
    const small = this.compact ? 56 : this.big ? 64 : 52
    const mk = (x: number, w: number, label: string, color: number, onTap: () => void): void => {
      const img = this.add
        .image(x, y, ensureBevelPanel(this, w, bh, color, 5, true))
        .setDepth(700)
        .setInteractive()
      const text = this.add
        .text(
          x,
          y,
          label,
          headlineStyle(fitFontSize(label, w - 12, this.compact ? 16 : 24), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      img.on('pointerdown', onTap)
      this.ui.push(img, text)
    }
    this.pick = Math.max(1, Math.min(v.mine, this.pick))
    const left = width / 2 - (this.compact ? 150 : this.big ? 300 : 230)
    mk(left, small, '−', PALETTE.frameLit, () => this.step(-1))
    this.pickText = this.add
      .text(
        left + small + 14,
        y,
        String(this.pick),
        headlineStyle(this.compact ? 24 : this.big ? 40 : 32, PALETTE.amber),
      )
      .setOrigin(0.5)
      .setDepth(701)
    this.ui.push(this.pickText)
    mk(left + small * 2 + 28, small, '+', PALETTE.frameLit, () => this.step(1))
    const restX = left + small * 2.5 + 40
    const restW = Math.min(width - 16 - restX, this.big ? 520 : Number.POSITIVE_INFINITY)
    if (v.role === 'hide') {
      mk(restX + restW / 2, restW, this.t('game.marbles.hide'), PALETTE.orange, () =>
        this.commit('hide'),
      )
    } else {
      const w = (restW - 10) / 2
      mk(restX + w / 2, w, this.t('game.marbles.odd'), PALETTE.magenta, () => this.commit('odd'))
      mk(restX + w * 1.5 + 10, w, this.t('game.marbles.even'), PALETTE.cyan, () =>
        this.commit('even'),
      )
    }
  }

  protected frame(snap: MarblesSnapshot | null, time: number): void {
    if (!snap) return
    const own = snap.players[this.selfId]
    const viewId = this.watch.follow(seats(snap), this.selfId, time)
    this.playing = !!own?.opponentId && viewId === this.selfId
    if (viewId !== this.viewId) this.setView(viewId, own)
    const v = viewId === null ? undefined : snap.players[viewId]
    if (!v) return
    const key = `${v.turn}:${v.phase}:${v.role}:${v.youChose}`
    if (key !== this.layoutKey) {
      this.layoutKey = key
      this.buildControls(v)
      this.onChange(v)
    }
    this.paintPouches(v)
    this.paintAvatars(v, time)
    this.paintTimer(v)
    this.lastView = v
  }

  // A new seat at the table: yours on the first snapshot, or the next duel a spectator watches (a
  // duellist whose duel is over keeps their verdict in the HUD).
  private setView(viewId: string | null, own: MarblesPlayerView | undefined): void {
    const bye = own?.opponentId === null
    this.viewId = viewId
    this.layoutKey = ''
    this.pouchKey = ''
    this.lastView = undefined
    this.revealShown = 0
    this.myAvatar?.image.destroy()
    this.rivalAvatar?.image.destroy()
    this.myAvatar = undefined
    this.rivalAvatar = undefined
    this.banner?.setVisible(false)
    this.hint?.setVisible(this.playing)
    if (!this.playing) {
      this.hud?.setScore(
        bye
          ? this.t('game.common.duelBye')
          : own?.phase === 'done'
            ? this.t(verdictKey(own.won))
            : '',
      )
    }
  }

  // The two players at the ends of the table, reacting to every reveal and to the result.
  private paintAvatars(v: MarblesPlayerView, time: number): void {
    const viewId = this.viewId
    if (!viewId) return
    const px = avatarPx(this.compact ? 32 : this.big ? 64 : 48)
    const make = (id: string, y: number): AvatarSprite => {
      const a = new AvatarSprite(this, this.state.avatarOf(id), this.state.colorOf(id), px)
      a.image.setPosition(28 + px / 2, y).setDepth(10)
      return a
    }
    if (!this.myAvatar) this.myAvatar = make(viewId, this.rows.mine + 10)
    if (!this.rivalAvatar && v.opponentId)
      this.rivalAvatar = make(v.opponentId, this.rows.theirs + 10)
    let mine: AvatarExpression = 'idle'
    let theirs: AvatarExpression = 'idle'
    if (v.won !== null && v.phase === 'done') {
      mine = v.won ? 'happy' : 'ko'
      theirs = v.won ? 'ko' : 'happy'
    } else if (v.phase === 'reveal' && v.last) {
      const iGuessed = v.last.guesserId === viewId
      const iWon = iGuessed === v.last.correct
      mine = iWon ? 'happy' : 'hurt'
      theirs = iWon ? 'hurt' : 'happy'
    }
    this.myAvatar.setExpression(mine).tick(time)
    this.rivalAvatar?.setExpression(theirs).tick(time)
  }

  // Your pouch and theirs: a row of marbles (capped) with the count — redrawn only when it changes.
  private paintPouches(v: MarblesPlayerView): void {
    const key = `${this.viewId}:${v.mine}:${v.theirs}:${v.opponentId}`
    if (key === this.pouchKey) return
    this.pouchKey = key
    const g = this.pouches as Phaser.GameObjects.Graphics
    const { width } = this.scale
    g.clear()
    const row = (n: number, y: number): void => {
      const shown = Math.min(n, 20)
      const r = this.compact ? 6 : this.big ? 11 : 8
      const span = shown * r * 2.4
      for (let i = 0; i < shown; i++) {
        g.fillStyle(MARBLE_COLORS[i % MARBLE_COLORS.length] ?? PALETTE.cyan, 1)
        g.fillCircle(width / 2 - span / 2 + r * 1.2 + i * r * 2.4, y, r)
        g.fillStyle(0xffffff, 0.5)
        g.fillCircle(width / 2 - span / 2 + r * 0.9 + i * r * 2.4, y - r * 0.35, r * 0.3)
      }
    }
    const viewId = this.viewId ?? this.selfId
    const oppName = v.opponentId ? this.label(v.opponentId) : ''
    this.theirsText?.setText(
      v.opponentId ? this.t('game.marbles.theirs', { name: oppName, n: v.theirs }) : '',
    )
    this.mineText?.setText(
      this.playing
        ? this.t('game.marbles.mine', { n: v.mine })
        : this.t('game.marbles.theirs', { name: this.label(viewId), n: v.mine }),
    )
    this.mineText?.setColor(hexToCss(this.state.colorOf(viewId, PALETTE.amber)))
    if (v.opponentId) this.theirsText?.setColor(hexToCss(this.state.colorOf(v.opponentId)))
    row(v.theirs, this.rows.theirs + (this.compact ? 22 : this.big ? 40 : 28))
    row(v.mine, this.rows.mine)
  }

  private paintTimer(v: MarblesPlayerView): void {
    const g = this.timer as Phaser.GameObjects.Graphics
    g.clear()
    if (v.phase !== 'choose') return
    const { width } = this.scale
    const w = Math.min(320, width - 64)
    const frac = Math.max(0, Math.min(1, v.msLeft / MARBLES.chooseMs))
    const y = this.rows.centre + (this.compact ? 22 : 28)
    g.fillStyle(PALETTE.panelAlt, 1).fillRect(width / 2 - w / 2, y, w, 6)
    g.fillStyle(frac < 0.3 ? PALETTE.red : PALETTE.amber, 1).fillRect(
      width / 2 - w / 2,
      y,
      w * frac,
      6,
    )
  }

  // Phase changes: the prompt, the reveal (open fist + marbles rolling), the end. A spectator gets the
  // same table told in the third person.
  private onChange(v: MarblesPlayerView): void {
    const prompt = this.prompt as Phaser.GameObjects.Text
    const status = this.status as Phaser.GameObjects.Text
    const opponentId = v.opponentId
    const viewId = this.viewId
    if (!opponentId || !viewId) return
    const watching = !this.playing
    if (v.phase === 'choose') {
      if (watching) {
        prompt.setText(this.t('game.marbles.turn', { n: v.turn })).setColor(hexToCss(PALETTE.text))
        status.setText(
          this.watchLine(
            this.t('game.common.duelWatch', {
              a: this.state.nameOf(viewId),
              b: this.state.nameOf(opponentId),
            }),
          ),
        )
        return
      }
      prompt.setText(
        this.t(v.role === 'hide' ? 'game.marbles.hidePrompt' : 'game.marbles.guessPrompt'),
      )
      prompt.setColor(hexToCss(v.role === 'hide' ? PALETTE.orange : PALETTE.cyan))
      status.setText(
        v.youChose
          ? this.t('game.marbles.waiting', { name: this.label(opponentId) })
          : this.t('game.marbles.turn', { n: v.turn }),
      )
      return
    }
    const last = v.last
    if (last && v.turn !== this.revealShown) {
      this.revealShown = v.turn
      const guessed = last.guesserId === viewId
      const iWon = guessed === last.correct
      prompt.setText(
        this.t('game.marbles.reveal', {
          n: last.hidden,
          parity: this.t(last.hidden % 2 === 1 ? 'game.marbles.odd' : 'game.marbles.even'),
        }),
      )
      prompt.setColor(hexToCss(watching ? PALETTE.amber : iWon ? PALETTE.lime : PALETTE.red))
      const taker = iWon ? viewId : opponentId
      status.setText(
        watching
          ? this.watchLine(
              this.t('game.marbles.takes', { name: this.state.nameOf(taker), n: last.moved }),
            )
          : this.t(iWon ? 'game.marbles.youTake' : 'game.marbles.theyTake', { n: last.moved }),
      )
      this.revealFist(last.hidden, iWon)
      // Your take (or your loss) rings out once the marbles have clattered onto the table.
      if (!watching) this.time.delayedCall(340, () => (iWon ? this.sfx.coin() : this.sfx.hurt()))
    }
    if (v.phase === 'done' && this.banner) {
      if (watching) {
        const winner = v.won === null ? null : v.won ? viewId : opponentId
        showBanner(
          this,
          this.banner,
          winner
            ? this.t('game.common.duelWinner', { name: this.state.nameOf(winner) })
            : this.t('game.common.draw'),
          winner ? this.state.colorOf(winner, PALETTE.amber) : PALETTE.amber,
        )
        this.sfx.tick()
        return
      }
      const text =
        v.won === null
          ? this.t('game.common.draw')
          : v.won
            ? this.t('game.common.youWin')
            : this.t('game.common.youLose')
      showBanner(
        this,
        this.banner,
        text,
        v.won ? PALETTE.lime : v.won === null ? PALETTE.amber : PALETTE.red,
      )
      if (v.oppLeft) {
        status.setText(this.t('game.common.duelOppLeft', { name: this.state.nameOf(opponentId) }))
      }
      if (v.won) this.sfx.win()
      // Out of marbles: out of the game.
      else if (v.won === false) this.sfx.eliminated()
      else this.sfx.tick()
    }
  }

  // A spectator's status line: the bye's consolation first, then what's happening at the table.
  private watchLine(line: string): string {
    const bye = this.snap?.players[this.selfId]?.opponentId === null
    return bye ? `${this.t('game.marbles.bye')}\n${line}` : line
  }

  // The fist opens on the table showing the hidden marbles, which then roll to the winner.
  private revealFist(n: number, iWon: boolean): void {
    const { width } = this.scale
    const r = this.compact ? 9 : this.big ? 16 : 12
    const y = this.rows.centre
    for (let i = 0; i < Math.min(n, 20); i++) {
      const key = ensurePixelOrb(
        this,
        `marble-${i % MARBLE_COLORS.length}`,
        8,
        MARBLE_COLORS[i % MARBLE_COLORS.length] ?? PALETTE.cyan,
        3,
      )
      const x = width / 2 + (i - (Math.min(n, 20) - 1) / 2) * r * 2.2
      const img = this.add
        .image(x, y, key)
        .setDisplaySize(r * 2, r * 2)
        .setDepth(20)
        .setScale(0)
      this.tweens.chain({
        targets: img,
        tweens: [
          { scale: (r * 2) / 24, duration: 160, delay: i * 40, ease: 'Back.easeOut' },
          {
            y: iWon ? this.rows.mine : this.rows.theirs + 24,
            alpha: 0,
            delay: 700,
            duration: 450,
            ease: 'Quad.easeIn',
          },
        ],
        onComplete: () => img.destroy(),
      })
    }
    burst(this, width / 2, y, shade(PALETTE.amber, 0.2), 8, 120)
    floatText(this, width / 2, y - 30, String(n), PALETTE.amber, this.compact ? 16 : 24)
    // The marbles clatter onto the table as they pop out (a few clicks, however many there are),
    // then roll off to the winner — quieter at a table you're only watching.
    const level = this.playing ? 1 : 0.5
    for (let i = 0; i < Math.min(n, 5); i++) {
      const pitch = 0.55 + ((i * 3) % 5) * 0.1
      this.time.delayedCall(i * 60, () => this.sfx.quiet(() => this.sfx.bounce(pitch), level))
    }
    this.time.delayedCall(860, () => this.sfx.quiet(() => this.sfx.whoosh(), level))
  }
}
