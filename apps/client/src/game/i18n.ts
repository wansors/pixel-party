// Translation function handed to Phaser scenes. The framework-agnostic game layer must not depend on
// Angular/Transloco directly, so the room component injects a bound translate() through this seam.
// Scenes call it every frame in update(), so a language switch reflects on the next rendered frame.
export type Translate = (key: string, params?: Record<string, unknown>) => string
