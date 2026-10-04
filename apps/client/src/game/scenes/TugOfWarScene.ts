import { PALETTE, type TeamId, type TugOfWarSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, floatText, punch, ring, showBanner } from '../fx'
import { bodyStyle, ensurePixelGrid, headlineStyle, shade, teamColor } from '../pixelStyle'
import { addShadow, type Shadow, YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const ROPE = 0xc9a36b
const ROPE_DARK = 0x8a6a3e
const ROPE_EDGE = 0x4a3520
const LEAD_DEADZONE = 0.08 // offsets this close to 0 don't count as a lead change
const DANGER = 0.7 // knot this close to a post = "almost there"

// Pullers are the players' avatars in side view, facing the knot (red faces right, blue is flipped),
// leaning back to brace and further back on each of their team's pulls. The rope runs at belly height,
// HAND_HEIGHT of an avatar above the ground (the field is laid out in `ps`-sized rows, 12 per puller).
const HAND_HEIGHT = 0.34

// Knot pennant hanging from the middle of the rope, colored by whoever is ahead.
const PENNANT_ROWS = [
  '_kkkkk_',
  'ktttttk',
  '_kkkkk_',
  '__kfk__',
  '_kfffk_',
  '_kfhfk_',
  '_kfffk_',
  '_kfhfk_',
  '_kfffk_',
  '_kf_fk_',
  '_k___k_',
]

// Candy-striped goal post with a team flag pointing at the middle of the field.
function postRows(): string[] {
  const rows = ['pp______', 'ppffff__', 'ppfffff_', 'ppfhff__', 'pp______']
  for (let y = 0; y < 13; y++) rows.push(Math.floor(y / 2) % 2 === 0 ? 'pp______' : 'qq______')
  rows.push('oooo____')
  return rows
}

// One decimal, until a long round's averages reach three digits (keeps the plate's number narrow).
const formatAvg = (avg: number): string => (avg < 100 ? avg.toFixed(1) : String(Math.round(avg)))

interface Puller {
  id: string
  team: TeamId
  avatar: AvatarSprite
  shadow: Shadow
  heaveUntil: number
}

// Tug of War (team) canvas: a pixel rope with a pennant on its knot, red pullers on the left and blue on
// the right (each member drawn in their own identity color), goal posts in the team colors. The rope
// springs toward the server's offset so every change in balance lurches visibly; the team that drags
// the knot to its own post wins. The plates show each team's pulls PER HEAD — the average is what
// moves the rope, so a smaller team isn't behind on raw totals. A member who left is greyed out.
// Click / tap / SPACE / ENTER = one pull (team members only; holding a key doesn't repeat).
export class TugOfWarScene extends MiniGameScene<TugOfWarSnapshot> {
  private rope?: Phaser.GameObjects.Graphics
  private pennant?: Phaser.GameObjects.Image
  private pennantKeys: Record<TeamId | 'even', string> = { red: '', blue: '', even: '' }
  private posts: Partial<Record<TeamId, Phaser.GameObjects.Image>> = {}
  private avgs: Partial<Record<TeamId, Phaser.GameObjects.Text>> = {}
  private prompt?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private pullers: Puller[] = []
  private extra: Partial<Record<TeamId, Phaser.GameObjects.Text>> = {}
  private built = false
  private cx = 0
  private reach = 0 // px from the center line to a goal post (= offset ±1)
  private groundY = 0
  private ropeY = 0
  private pullerPx = 0
  private ps = 4
  private spacing = 0
  private gapFromKnot = 0
  private disp = 0 // displayed (spring-smoothed) rope offset
  private vel = 0
  private wobble = 0
  private lastOffset = 0
  private lastAvg: Record<TeamId, number> = { red: 0, blue: 0 }
  private leader: TeamId | null = null
  private danger: TeamId | null = null
  private lastDust: Record<TeamId, number> = { red: 0, blue: 0 }
  private ended = false
  private pulls = 0
  private ropeKey = ''

  constructor(...deps: SceneDeps) {
    super('tug-of-war', ...deps)
  }

  override create(): void {
    super.create()
    this.pullers = []
    this.extra = {}
    this.posts = {}
    this.avgs = {}
    this.built = false
    this.disp = 0
    this.vel = 0
    this.wobble = 0
    this.lastOffset = 0
    this.lastAvg = { red: 0, blue: 0 }
    this.leader = null
    this.danger = null
    this.ended = false
    this.pulls = 0
    this.ropeKey = ''

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const big = Math.min(width, height) >= 900
    const top = this.top
    const avail = height - top
    this.cx = width / 2
    this.reach = width * (compact ? 0.24 : 0.2)
    // Pixel size of the field art: bigger pullers on a 1080p screen, as long as four a side fit.
    this.ps = compact ? 5 : big ? Math.max(7, Math.min(10, Math.floor(width / 170))) : 7
    this.spacing = 9 * this.ps * (compact ? 1.05 : 1.2)
    this.gapFromKnot = 9 * this.ps * 0.9
    this.groundY = Math.round(top + avail * (compact ? 0.5 : 0.56))
    this.pullerPx = avatarPx(12 * this.ps)
    this.ropeY = this.groundY - Math.round(this.pullerPx * HAND_HEIGHT)

    this.drawPlates(compact, big)
    this.drawField(width, compact)

    this.rope = this.add.graphics().setDepth(10)
    this.pennantKeys = {
      red: this.pennantKey('red', teamColor('red')),
      blue: this.pennantKey('blue', teamColor('blue')),
      even: this.pennantKey('even', PALETTE.amber),
    }
    this.pennant = this.add
      .image(this.cx, this.ropeY, this.pennantKeys.even)
      .setOrigin(0.5, 1.5 / PENNANT_ROWS.length)
      .setScale(Math.max(3, this.ps - 1))
      .setDepth(11)

    const groundH = compact ? 16 : 24
    const below = this.groundY + groundH
    this.prompt = this.add
      .text(
        this.cx,
        below + (height - below) * 0.36,
        '',
        headlineStyle(compact ? 32 : big ? 48 : 40, PALETTE.text, {
          align: 'center',
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5)
    this.hint = this.add
      .text(
        this.cx,
        height - 10,
        this.t(compact ? 'game.tugOfWar.hint' : 'game.tugOfWar.hintPc'),
        bodyStyle(compact ? 12 : big ? 16 : 15, PALETTE.dim, {
          align: 'center',
          wordWrap: { width: width * 0.92 },
        }),
      )
      .setOrigin(0.5, 1)
    this.marker = new YouMarker(this, compact ? 12 : 16, 12)
    // The finish banner takes the prompt's place under the field, so the rope stays in view.
    this.banner = addBanner(this)
      .setFontSize(compact ? 24 : 40)
      .setWordWrapWidth(width * 0.9)
      .setY(this.prompt.y)

    this.input.on('pointerdown', () => this.pull())
    this.onKey('SPACE', () => this.pull())
    this.onKey('ENTER', () => this.pull())
  }

  // Team plates: name over a "per head" caption + the team's average pulls per member, red top-left,
  // blue top-right.
  private drawPlates(compact: boolean, big: boolean): void {
    const { width } = this.scale
    const w = Math.min(width * 0.4, big ? 320 : 240)
    const h = compact ? 48 : big ? 84 : 64
    const y = this.top + (compact ? 6 : 12)
    const margin = compact ? 10 : 24
    for (const team of ['red', 'blue'] as const) {
      const color = teamColor(team)
      const x = team === 'red' ? margin : width - margin - w
      const g = this.add.graphics()
      g.fillStyle(shade(color, -0.75), 1)
      g.fillRect(x, y, w, h)
      g.fillStyle(shade(color, -0.45), 1)
      g.fillRect(x, y + h - 4, w, 4)
      g.lineStyle(3, color, 1)
      g.strokeRect(x, y, w, h)
      const align = team === 'red' ? 0 : 1
      const tx = team === 'red' ? x + 12 : x + w - 12
      this.add
        .text(
          tx,
          y + h * 0.36,
          this.t(`team.${team}`).toUpperCase(),
          headlineStyle(big ? 24 : 16, color),
        )
        .setOrigin(align, 0.5)
      this.add
        .text(
          tx,
          y + h * 0.36 + (compact ? 12 : big ? 20 : 16),
          this.t('game.tugOfWar.perHead'),
          bodyStyle(compact ? 11 : big ? 16 : 13, PALETTE.dim),
        )
        .setOrigin(align, 0)
      this.avgs[team] = this.add
        .text(
          team === 'red' ? x + w - 12 : x + 12,
          y + h / 2,
          '0.0',
          headlineStyle(compact ? 16 : big ? 32 : 24, PALETTE.text),
        )
        .setOrigin(1 - align, 0.5)
    }
  }

  // Grass field, home zones behind each goal post, the center mark and the posts themselves.
  private drawField(width: number, compact: boolean): void {
    const groundH = compact ? 16 : 24
    const g = this.add.graphics()
    g.fillStyle(0x1d3a24, 1)
    g.fillRect(0, this.groundY, width, groundH)
    for (const team of ['red', 'blue'] as const) {
      const color = teamColor(team)
      const x0 = team === 'red' ? 0 : this.cx + this.reach
      g.fillStyle(shade(color, -0.6), 1)
      g.fillRect(x0, this.groundY, this.cx - this.reach, groundH)
    }
    g.fillStyle(PALETTE.lime, 0.55)
    for (let x = 6; x < width; x += 22) g.fillRect(x, this.groundY - 3, 4, 3)
    g.fillStyle(shade(PALETTE.lime, -0.35), 1)
    g.fillRect(0, this.groundY, width, 3)
    for (const team of ['red', 'blue'] as const) {
      g.fillStyle(teamColor(team), 1)
      g.fillRect(team === 'red' ? 0 : this.cx + this.reach, this.groundY, this.cx - this.reach, 3)
    }
    g.fillStyle(PALETTE.text, 0.8)
    for (let y = this.groundY + 5; y < this.groundY + groundH; y += 6)
      g.fillRect(this.cx - 2, y, 4, 3)

    for (const team of ['red', 'blue'] as const) {
      const color = teamColor(team)
      const key = ensurePixelGrid(this, {
        key: `pp-tug-post-${team}-${this.ps}`,
        rows: postRows(),
        legend: { p: PALETTE.text, q: color, f: color, h: shade(color, 0.45), o: 0x2b2f45 },
        pixelSize: this.ps,
      })
      const x = team === 'red' ? this.cx - this.reach : this.cx + this.reach
      this.posts[team] = this.add
        .image(x, this.groundY + 2, key)
        .setOrigin(team === 'red' ? 0.125 : 0.875, 1)
        .setFlipX(team === 'blue')
        .setDepth(5)
    }
  }

  private pennantKey(name: string, color: number): string {
    return ensurePixelGrid(this, {
      key: `pp-tug-pennant-${name}`,
      rows: PENNANT_ROWS,
      legend: { k: ROPE_EDGE, t: ROPE, f: color, h: shade(color, 0.4) },
      pixelSize: 1,
    })
  }

  // Team membership is fixed for the round: build each side's line of pullers from the first snapshot.
  private build(snap: TugOfWarSnapshot): void {
    this.built = true
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    const maxShown = compact ? 3 : 4
    for (const team of ['red', 'blue'] as const) {
      const ids = Object.keys(snap.teams)
        .filter((id) => snap.teams[id] === team)
        .sort((a, b) => (a === this.selfId ? -1 : b === this.selfId ? 1 : a.localeCompare(b)))
      const size = this.pullerPx
      for (const id of ids.slice(0, maxShown)) {
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(id),
          this.state.colorOf(id, teamColor(team)),
          size,
          'side',
        )
        avatar.face(team === 'red' ? 1 : -1)
        avatar.image
          .setOrigin(0.5, 1)
          .setPosition(0, this.groundY + 1)
          .setDepth(8)
        const shadow = addShadow(this, size, 7).setY(this.groundY)
        this.pullers.push({ id, team, avatar, shadow, heaveUntil: 0 })
      }
      if (ids.length > maxShown) {
        this.extra[team] = this.add
          .text(
            0,
            this.groundY - 12 * this.ps - 4,
            `+${ids.length - maxShown}`,
            bodyStyle(this.ps >= 9 ? 20 : 14),
          )
          .setOrigin(0.5, 1)
          .setDepth(8)
      }
    }
  }

  private myTeam(): TeamId | undefined {
    return this.snap?.teams[this.selfId]
  }

  private pull(): void {
    const snap = this.snap
    if (!snap || snap.done || snap.remainingMs <= 0 || !this.myTeam()) return
    this.sendInput({ kind: 'pull' })
    // Heels digging in, left-right, on every heave.
    this.sfx.step(++this.pulls)
    const me = this.pullers.find((p) => p.id === this.selfId)
    if (me) {
      me.heaveUntil = this.time.now + 120
      if (this.pulls % 3 === 0) burst(this, me.avatar.image.x, this.groundY, 0x8a7a5a, 4, 70)
    }
    if (this.prompt) punch(this, this.prompt, 0.08, 60)
  }

  protected frame(snap: TugOfWarSnapshot | null, time: number, delta: number): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    const team = snap.teams[this.selfId]
    this.hint?.setVisible(team !== undefined) // spectators have nothing to press
    this.trackEvents(snap, time, team)

    // Spring toward the authoritative offset: slight overshoot = the rope lurches, then settles.
    const dt = Math.min(0.05, delta / 1000)
    const acc = 90 * (snap.offset - this.disp) - 12 * this.vel
    this.vel += acc * dt
    this.disp = Phaser.Math.Clamp(this.disp + this.vel * dt, -1.08, 1.08)
    this.wobble *= 0.9
    const knotX = this.cx + this.disp * this.reach

    this.drawRope(knotX, time)
    this.placePullers(knotX, time)
    this.updatePrompt(snap, team)
  }

  // Snapshot deltas → feedback: totals (pull pops), lurches, lead changes, near-win, the finish.
  private trackEvents(snap: TugOfWarSnapshot, time: number, team: TeamId | undefined): void {
    this.hud?.setScore(
      team ? `${this.t('game.tugOfWar.team')}: ${this.t(`team.${team}`).toUpperCase()}` : '',
    )
    // First snapshot (fresh round or relayout restart): adopt the state as the baseline — the rope
    // sits where it is, the averages show, and no "RED LEADS!" / "ALMOST!" replays.
    if (this.firstSnapshot) {
      for (const t of ['red', 'blue'] as const) {
        this.lastAvg[t] = snap.avg[t]
        this.avgs[t]?.setText(formatAvg(snap.avg[t]))
      }
      this.disp = snap.offset
      this.lastOffset = snap.offset
      this.leader =
        snap.offset < -LEAD_DEADZONE ? 'red' : snap.offset > LEAD_DEADZONE ? 'blue' : null
      this.danger = snap.offset <= -DANGER ? 'red' : snap.offset >= DANGER ? 'blue' : null
    }
    for (const t of ['red', 'blue'] as const) {
      const avg = snap.avg[t]
      const text = this.avgs[t]
      if (avg !== this.lastAvg[t]) text?.setText(formatAvg(avg))
      // A leaver can move the average either way; only a rise is a pull.
      if (avg > this.lastAvg[t]) {
        if (text) punch(this, text, 0.18, 70)
        for (const p of this.pullers) if (p.team === t) p.heaveUntil = time + 110
      }
      this.lastAvg[t] = avg
    }

    const change = snap.offset - this.lastOffset
    if (Math.abs(change) > 0.03) {
      this.wobble = Math.min(10, this.wobble + Math.abs(change) * 70)
      // The side being dragged kicks up dust (one puff under its front puller).
      const dragged: TeamId = change < 0 ? 'blue' : 'red'
      const front = this.pullers.find((p) => p.team === dragged)
      if (front && time - this.lastDust[dragged] > 260) {
        this.lastDust[dragged] = time
        burst(this, front.avatar.image.x, this.groundY, 0x8a7a5a, 8, 90)
      }
    }
    this.lastOffset = snap.offset

    const leader: TeamId | null =
      snap.offset < -LEAD_DEADZONE ? 'red' : snap.offset > LEAD_DEADZONE ? 'blue' : this.leader
    if (leader && leader !== this.leader) {
      const x = this.cx + snap.offset * this.reach
      floatText(
        this,
        x,
        this.ropeY - 12 * this.ps,
        this.t('game.tugOfWar.leads', { team: this.t(`team.${leader}`).toUpperCase() }),
        teamColor(leader),
        16,
      )
      // Your side takes the lead with a surge; losing it, the rope whips away from you.
      if (team) {
        if (leader === team) this.sfx.powerUp()
        else this.sfx.whoosh()
      }
    }
    if (leader !== this.leader || this.firstSnapshot) {
      this.pennant?.setTexture(this.pennantKeys[leader ?? 'even'])
    }
    this.leader = leader

    const danger: TeamId | null =
      snap.offset <= -DANGER ? 'red' : snap.offset >= DANGER ? 'blue' : null
    if (danger && danger !== this.danger) {
      const post = this.posts[danger]
      if (post) {
        ring(this, post.x, this.ropeY, teamColor(danger), 48)
        floatText(
          this,
          post.x,
          post.y - post.displayHeight - 8,
          this.t('game.tugOfWar.almost'),
          teamColor(danger),
          16,
        )
      }
      this.sfx.urgent()
    }
    this.danger = danger
    for (const t of ['red', 'blue'] as const) {
      const alpha = this.danger === t ? 0.55 + 0.45 * Math.abs(Math.sin(time / 90)) : 1
      const post = this.posts[t]
      if (post && post.alpha !== alpha) post.setAlpha(alpha)
    }

    if (snap.done && !this.ended) this.finish(snap, team)
  }

  private finish(snap: TugOfWarSnapshot, team: TeamId | undefined): void {
    this.ended = true
    const winner: TeamId | null = snap.offset < 0 ? 'red' : snap.offset > 0 ? 'blue' : null
    if (!this.banner) return
    if (winner === null) {
      showBanner(this, this.banner, this.t('game.common.draw'), PALETTE.amber)
      this.sfx.tick()
      return
    }
    const color = teamColor(winner)
    const post = this.posts[winner]
    if (post) {
      burst(this, post.x, this.ropeY, color, 28, 300)
      burst(this, post.x, this.ropeY, PALETTE.amber, 16, 240)
    }
    // The losers hit the dirt; the crowd roars for the winners.
    if (!team) {
      const name = this.t(`team.${winner}`).toUpperCase()
      showBanner(this, this.banner, this.t('game.tugOfWar.teamWins', { team: name }), color)
      this.sfx.land()
      this.sfx.cheer()
    } else if (team === winner) {
      showBanner(this, this.banner, this.t('game.common.youWin'), PALETTE.lime)
      this.sfx.cheer()
      this.sfx.coin()
    } else {
      showBanner(this, this.banner, this.t('game.common.youLose'), PALETTE.red)
      this.sfx.land()
      this.sfx.wrong()
    }
  }

  // Twisted rope (alternating strands) across the whole field; it sags and ripples after a lurch.
  private drawRope(knotX: number, time: number): void {
    const g = this.rope
    if (!g) return
    // A still, settled rope doesn't need redrawing every frame.
    const key = this.wobble < 0.05 ? `${Math.round(knotX)}` : ''
    if (key !== '' && key === this.ropeKey) return
    this.ropeKey = key
    g.clear()
    const { width } = this.scale
    const seg = this.ps * 2
    const thick = Math.max(4, this.ps + 1)
    const phase = Math.floor(knotX / seg)
    for (let x = -seg; x < width + seg; x += seg) {
      const d = (x - knotX) / Math.max(1, this.scale.width)
      const y =
        this.ropeY +
        this.wobble * Math.sin(d * 18 + time / 45) * (1 - Math.min(1, Math.abs(d) * 1.4))
      const idx = Math.floor(x / seg) - phase
      g.fillStyle(ROPE_EDGE, 1)
      g.fillRect(Math.round(x), Math.round(y - thick / 2) + 1, seg, thick + 1)
      g.fillStyle(idx % 2 === 0 ? ROPE : ROPE_DARK, 1)
      g.fillRect(Math.round(x), Math.round(y - thick / 2), seg, thick - 1)
    }
    this.pennant?.setPosition(Math.round(knotX), this.ropeY)
  }

  private placePullers(knotX: number, time: number): void {
    const idx: Record<TeamId, number> = { red: 0, blue: 0 }
    for (const p of this.pullers) {
      const i = idx[p.team]++
      const dir = p.team === 'red' ? -1 : 1
      const x = knotX + dir * (this.gapFromKnot + i * this.spacing)
      // Lean back (away from the knot) to brace, further on a heave; at the whistle the winners
      // cheer and the losers are flattened. A member who left has let go: greyed out and limp.
      const gone = this.snap !== null && !(p.id in this.snap.teams)
      const heaving = time < p.heaveUntil && !gone
      const end = this.snap?.done ? this.winner() : null
      p.avatar
        .setExpression(
          end ? (end === p.team ? 'happy' : 'ko') : gone ? 'ko' : heaving ? 'hurt' : 'idle',
        )
        .tick(time)
      p.avatar.image
        .setX(Math.round(x))
        .setAngle(dir * (end || gone ? 0 : heaving ? 22 : 10))
        .setAlpha(gone ? 0.4 : 1)
      p.shadow.setX(Math.round(x))
    }
    for (const t of ['red', 'blue'] as const) {
      const label = this.extra[t]
      if (!label) continue
      const dir = t === 'red' ? -1 : 1
      label.setX(knotX + dir * (this.gapFromKnot + (idx[t] - 0.5) * this.spacing))
    }
    const me = this.pullers.find((p) => p.id === this.selfId)
    if (me)
      this.marker?.place(me.avatar.image.x, me.avatar.image.y - me.avatar.image.displayHeight, time)
  }

  // The side the knot ended on (null = dead even).
  private winner(): TeamId | null {
    const offset = this.snap?.offset ?? 0
    return offset < 0 ? 'red' : offset > 0 ? 'blue' : null
  }

  private updatePrompt(snap: TugOfWarSnapshot, team: TeamId | undefined): void {
    const prompt = this.prompt
    if (!prompt) return
    if (snap.done) {
      prompt.setVisible(false)
      return
    }
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    const mode = team ?? 'spectator'
    if (prompt.getData('mode') === mode) return
    prompt.setData('mode', mode)
    if (team) {
      prompt
        .setText(this.t('game.tugOfWar.pull'))
        .setStyle(headlineStyle(compact ? 32 : 40, teamColor(team), { align: 'center' }))
    } else {
      prompt.setText(this.t('game.tugOfWar.spectator')).setStyle(
        bodyStyle(compact ? 15 : 20, PALETTE.text, {
          align: 'center',
          wordWrap: { width: this.scale.width * 0.9 },
        }),
      )
    }
  }
}
