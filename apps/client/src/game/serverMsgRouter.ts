import type { ServerMsg, ServerMsgType } from '@pp/shared'

type Handler<K extends ServerMsgType> = (msg: Extract<ServerMsg, { type: K }>) => void

// Typed dispatch table: `.on(type, handler)` narrows the message to that variant. Unregistered types
// are no-ops, so adding a handled message is one registration — no growing if/else.
export class ServerMsgRouter {
  private readonly handlers = new Map<ServerMsgType, (msg: ServerMsg) => void>()

  on<K extends ServerMsgType>(type: K, handler: Handler<K>): this {
    this.handlers.set(type, handler as (msg: ServerMsg) => void)
    return this
  }

  dispatch(msg: ServerMsg): void {
    this.handlers.get(msg.type)?.(msg)
  }
}
