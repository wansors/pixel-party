import type { SceneDeps } from './MiniGameScene'
import { TetrisSprintSceneBase } from './TetrisSprintSceneBase'

// Quick Tetris: the shared Tetris sprint canvas, first to clear the target lines.
export class QuickTetrisScene extends TetrisSprintSceneBase {
  constructor(...deps: SceneDeps) {
    super('quick-tetris', ...deps)
  }
}
