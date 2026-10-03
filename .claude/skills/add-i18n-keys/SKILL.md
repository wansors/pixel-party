---
name: add-i18n-keys
description: Add or update Pixel Party UI/game translation keys (EN + ES) safely. Use whenever a change introduces a user-facing string in the Angular shell or a Phaser scene, adds a mini-game (catalog name/blurb), or fixes a hardcoded English string — instead of hand-editing en.json/es.json.
---

# Add i18n keys (EN + ES)

All user-facing text lives in `apps/client/src/assets/i18n/en.json` and `es.json` (Transloco). Both
files must always carry the **same key set**; never hand-edit them when other agents/sessions might be
editing too — use the locked merge helper, which deep-merges, validates and re-formats with Biome.

```bash
python3 .claude/skills/add-i18n-keys/i18n-add.py '{
  "en": {"game": {"simon": {"levelUp": "LEVEL UP!"}}},
  "es": {"game": {"simon": {"levelUp": "¡SUBES DE NIVEL!"}}}
}'
```

(`bunx` must be on the PATH for the Biome re-format; see the `verify-all` skill if Bun is missing.)

## Conventions
- Namespaces: shell UI under `room.*`, `join.*`, `common.*`; scenes under `game.<camelCaseId>.*`
  (`game.pixelHoops`, `game.quickDraw`…); mini-game catalog entries under
  `catalog.minigame.<id>.name` / `.blurb` (read by `CatalogI18nService`, English fallback = the
  `@pp/shared` MINIGAMES meta — but every id should have both languages).
- Shared scene strings already exist under `game.common` (`you`, `pts {n}`, `level {n}`, `combo {n}`,
  `youWin`, `youLose`, `draw`, `out`, `miss`, `perfect`, `great`, `good`, `wrong`, `nice`, `waiting`,
  `finished`, `done`, `correct {n}`) — reuse before adding.
- Interpolation is `{{name}}` (Transloco); scenes call `this.t('game.x.key', { name })`.
- Spanish is **Spain Spanish, colloquial and playful — never neutral** (D26): tú/vosotros, the
  pretérito perfecto for recent events ("¡HAS GANADO!", "te has adelantado"), Spain vocabulary
  (pulsar, ordenador, móvil, vale, colega, pillar, petar, pringao, ni fu ni fa) and set phrases where
  they fit (me planto, pares o nones, escondite inglés). Fully accented (á é í ó ú ñ ¡ ¿), same
  length budget as the English (the pixel font is wide — keep HUD/banners short; prompts squeezed
  with `fitFontSize` must fit ~45 chars on a phone).
- Server-side result stats (`NormalizedResult.stats`, English) are translated word by word on the
  client (`core/i18n/stat-i18n.ts` + `room.stat.*`): a new stat word needs an entry there.
- Arrays are flavor-line pools (`room.result.callout.*`, `game.common.stamps`, NPC heckles), read
  with `quip()` / `pickLine()` from `game/quips.ts` (a seeded pick, the same line on every client). The
  two languages' pools don't need to match line for line — each gets its own jokes.

## Check for gaps
```bash
python3 - <<'PY'
import json,re,glob
en=json.load(open('apps/client/src/assets/i18n/en.json')); es=json.load(open('apps/client/src/assets/i18n/es.json'))
def keys(d,p=''):
  s=set()
  for k,v in d.items(): s|=keys(v,f'{p}.{k}' if p else k) if isinstance(v,dict) else {f'{p}.{k}' if p else k}
  return s
print('en-only:',sorted(keys(en)-keys(es))); print('es-only:',sorted(keys(es)-keys(en)))
used=set(m for f in glob.glob('apps/client/src/**/*.ts',recursive=True) for m in re.findall(r"t\('((?:game|room|join|common)\.[\w.]+)'",open(f).read()))
print('used but missing:',sorted(k for k in used if k not in keys(en)))
PY
```
