import type { IdGenerator } from '../../../application/ports/IdGenerator'

// Unambiguous room-code alphabet: no 0/O/1/I to avoid misreads when a code is shared verbally.
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class CryptoIdGenerator implements IdGenerator {
  playerId(): string {
    return crypto.randomUUID()
  }

  secret(): string {
    return crypto.randomUUID()
  }

  roomCode(len: number): string {
    const bytes = new Uint8Array(len)
    crypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < len; i++) out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length]
    return out
  }
}
