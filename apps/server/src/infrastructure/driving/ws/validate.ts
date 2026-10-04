import type { ClientMsg } from '@pp/shared'

// Client-message SHAPE validator for the WS trust boundary — replaces an unchecked
// `JSON.parse(...) as ClientMsg` cast with a per-type gate: known discriminant · required fields present
// · each field's PRIMITIVE type correct · optional fields checked only when present.
//
// SHAPE, not DOMAIN: number/string fields are `typeof` only (no range/finite/enum-membership). Domain
// refinements (host authority, config bounds, valid mini-game ids, phase legality) stay in the
// handlers/use-cases. An unknown discriminant returns `true` here (deferred to the caller's
// unknown-intent responder); only a KNOWN type with a bad shape returns `false`.

type Validator = (m: Record<string, unknown>) => boolean

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
// Every mini-game input is a JSON object; null, primitives and arrays never are.
const isObj = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)

// Exhaustive per-type table. `satisfies Record<ClientMsg['type'], Validator>` is load-bearing: adding a
// future ClientMsg variant FAILS typecheck until a validator is added here.
const VALIDATORS = {
  JOIN: (m) =>
    isStr(m.name) &&
    isStr(m.color) &&
    isStr(m.avatar) &&
    (m.touch === undefined || isBool(m.touch)),
  REJOIN: (m) => isStr(m.playerId) && isStr(m.token),
  SET_READY: (m) => isBool(m.ready),
  HOST_CONFIG: (m) =>
    isStrArray(m.minigameIds) &&
    isNum(m.rounds) &&
    (m.handicap === undefined || isBool(m.handicap)),
  SET_TEAM: (m) => isStr(m.playerId) && isStr(m.team),
  SHUFFLE_TEAMS: () => true,
  TRANSFER_HOST: (m) => isStr(m.playerId),
  KICK_PLAYER: (m) => isStr(m.playerId),
  START_SESSION: () => true,
  PLAY_AGAIN: () => true,
  SKIP_ROUND: () => true,
  MINIGAME_INPUT: (m) => isObj(m.input),
  LEAVE: () => true,
} satisfies Record<ClientMsg['type'], Validator>

export function isValidClientMsg(raw: unknown): raw is ClientMsg {
  if (typeof raw !== 'object' || raw === null) return false
  const m = raw as Record<string, unknown>
  if (typeof m.type !== 'string') return false
  const validator = (VALIDATORS as Record<string, Validator>)[m.type]
  // Unknown type: not this validator's concern — defer to the caller's unknown-intent path.
  if (!validator) return true
  return validator(m)
}
