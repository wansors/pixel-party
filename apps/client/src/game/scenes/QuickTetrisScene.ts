import type { ClientMsg } from '@pp/shared'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { TetrisSprintSceneBase } from './TetrisSprintSceneBase'

export class QuickTetrisScene extends TetrisSprintSceneBase {
  constructor(send: (msg: ClientMsg) => void, state: RoundState, sfx: Sfx, t: Translate) {
    super(send, state, sfx, t, 'quick-tetris')
  }
}
