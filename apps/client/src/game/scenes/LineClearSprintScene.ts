import type { SceneDeps } from './MiniGameScene'
import { TetrisSprintSceneBase } from './TetrisSprintSceneBase'

// Line Clear Sprint: the shared Tetris sprint canvas, most lines before the clock runs out.
export class LineClearSprintScene extends TetrisSprintSceneBase {
  constructor(...deps: SceneDeps) {
    super('line-clear-sprint', ...deps)
  }
}
