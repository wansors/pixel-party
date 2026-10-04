import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'

// One axis of the radar: a translated label and a 0..1 value — null when it hasn't been measured yet
// (drawn at the neutral middle with a dimmed label, not collapsed to the centre).
export interface RadarAxis {
  label: string
  value: number | null
}

const CX = 60
const CY = 60
const R = 40 // radius at value 1.0
// Value 0 still sits a little off the centre, so the data always reads as an area — a radar whose
// weak axes collapse to the middle draws spikes instead of a shape (D31).
const FLOOR = 0.18
const NEUTRAL = 0.5 // where an unmeasured axis sits; with `average`, the dashed "middle of the room" ring
const RINGS = [1, 0.75, 0.25] // reference rings drawn behind the data polygon
// Axis labels sit outside the shape and can be long ("Knowledge", "Conocimiento"), so the viewBox is
// widened horizontally around the 120x120 chart instead of clipping them at the edges.
const SIDE_MARGIN = 38
const WIDE = (120 + SIDE_MARGIN * 2) / 120

interface Pt {
  x: number
  y: number
}

// Inline-SVG skill radar (pentagon/hexagon…) for the post-match player profile. Dumb + OnPush: it draws
// whatever axes it is given, in order. Mirrors the crisp self-hosted SVG approach of PixelAvatarComponent
// (no charting library, CSP-safe).
@Component({
  selector: 'app-skill-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size() * WIDE"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      class="skill-radar"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      @for (ring of geo().rings; track $index) {
        <polygon [attr.points]="ring" class="ring" />
      }
      <polygon [attr.points]="geo().middle" class="ring" [class.middle]="average()" />
      @for (s of geo().spokes; track $index) {
        <line x1="60" y1="60" [attr.x2]="s.x" [attr.y2]="s.y" class="spoke" />
      }
      <polygon
        [attr.points]="geo().data"
        class="area"
        [attr.fill]="color()"
        [attr.stroke]="color()"
      />
      @for (d of geo().dots; track $index) {
        <circle [attr.cx]="d.x" [attr.cy]="d.y" r="1.6" [attr.fill]="color()" />
      }
      @for (l of geo().labels; track l.label) {
        <text
          [attr.x]="l.x"
          [attr.y]="l.y"
          [attr.text-anchor]="l.anchor"
          class="axis-label"
          [class.unmeasured]="l.unmeasured"
        >
          {{ l.label }}
        </text>
      }
    </svg>
  `,
  styles: `
    .skill-radar {
      display: block;
    }
    .ring {
      fill: none;
      stroke: rgba(159, 179, 200, 0.25);
      stroke-width: 0.5;
    }
    .spoke {
      stroke: rgba(159, 179, 200, 0.25);
      stroke-width: 0.5;
    }
    .ring.middle {
      stroke: rgba(195, 203, 220, 0.6);
      stroke-width: 0.7;
      stroke-dasharray: 2 1.5;
    }
    .area {
      fill-opacity: 0.35;
      stroke-width: 1.5;
      stroke-linejoin: round;
    }
    .axis-label {
      fill: #c3cbdc;
      font-family: monospace;
      font-size: 7px;
      dominant-baseline: middle;
    }
    .axis-label.unmeasured {
      fill: #6b7690;
    }
  `,
})
export class SkillRadarComponent {
  readonly WIDE = WIDE
  readonly viewBox = `${-SIDE_MARGIN} 0 ${120 + SIDE_MARGIN * 2} 120`

  readonly data = input<RadarAxis[]>([])
  readonly color = input<string>('#ffd166')
  readonly size = input<number>(200)
  readonly ariaLabel = input<string>('skill radar')
  // Values are standings against the room (0.5 = its middle): emphasise that ring as the reference.
  readonly average = input<boolean>(false)

  readonly geo = computed(() => {
    const axes = this.data()
    const n = axes.length
    const value = (i: number): number => Math.max(0, Math.min(1, axes[i]?.value ?? NEUTRAL))
    const rings = RINGS.map((f) => this.polygon(n, () => f))
    const middle = this.polygon(n, () => NEUTRAL)
    const spokes: Pt[] = axes.map((_, i) => this.point(i, n, R))
    const data = this.polygon(n, value)
    const dots = axes.flatMap((a, i) =>
      a.value === null ? [] : [this.point(i, n, radius(value(i)))],
    )
    const labels = axes.map((a, i) => {
      const p = this.point(i, n, R + 9)
      // Anchor by horizontal position so labels sit outside the shape without overlapping it.
      const anchor = p.x < CX - 1 ? 'end' : p.x > CX + 1 ? 'start' : 'middle'
      return { label: a.label, x: p.x, y: p.y, anchor, unmeasured: a.value === null }
    })
    return { rings, middle, spokes, data, dots, labels }
  })

  // Angle for axis i of n, starting at the top (12 o'clock) and going clockwise.
  private angle(i: number, n: number): number {
    return -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n)
  }

  private point(i: number, n: number, radius: number): Pt {
    const a = this.angle(i, n)
    return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) }
  }

  // Build an SVG points string over all axes, with the value (0..1) chosen per index.
  private polygon(n: number, frac: (i: number) => number): string {
    if (n === 0) return ''
    return Array.from({ length: n }, (_, i) => {
      const p = this.point(i, n, radius(frac(i)))
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`
    }).join(' ')
  }
}

// Radius for a 0..1 value: the floor keeps a 0 off the centre point.
function radius(value: number): number {
  return R * (FLOOR + (1 - FLOOR) * value)
}
