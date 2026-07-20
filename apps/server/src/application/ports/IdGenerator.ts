export interface IdGenerator {
  playerId(): string
  // A short, human-shareable room code (uppercase alnum). The registry retries on collision.
  roomCode(len: number): string
}
