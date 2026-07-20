/// <reference types="phaser" />
// TEST-ONLY Phaser stub. `tsconfig.spec.json` redirects `import Phaser from 'phaser'` here for the
// Karma/spec build ONLY, so the multi-MB real engine never enters the single test bundle. The default
// export is cast to the REAL ambient `typeof Phaser` namespace, so consumers keep full type fidelity
// (`extends Phaser.Scene`, `Phaser.Types.Core.GameConfig`, …) while the RUNTIME is this tiny object.
// Production (`build:client`) uses the real Phaser — the redirect lives only in tsconfig.spec.json.

class StubScene {}
class StubText {}
class StubGraphics {}

class StubGame {
  scene = { getScene: (_: string): undefined => undefined }
  destroy(_?: boolean): void {}
}

const phaserStub = {
  AUTO: 0,
  Scale: { NONE: 0, RESIZE: 1 },
  Scene: StubScene,
  Game: StubGame,
  GameObjects: {
    Text: StubText,
    Graphics: StubGraphics,
  },
}

export default phaserStub as unknown as typeof Phaser
