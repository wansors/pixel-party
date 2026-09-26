import { Pipe, type PipeTransform } from '@angular/core'

// Session points can be fractional (tie-averaged awards like 16/3, or a catch-up bonus): show at most
// one decimal and drop a trailing ".0", so "5.333333333333333" reads as "5.3" and "8.0" as "8".
export function formatPoints(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

@Pipe({ name: 'pts' })
export class PointsPipe implements PipeTransform {
  transform(n: number | null | undefined): string {
    return formatPoints(n ?? 0)
  }
}
