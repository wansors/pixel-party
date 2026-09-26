---
name: promo-video
description: Update or re-render Pixel Party's promotional video (docs/promo/promo.html → MP4, cut to the game's soundtrack). Use when the promo needs fresh footage (new games, UI changes), different captions/scenes, or a new export (MP4 or stills).
---

# Promo video

Everything lives in `docs/promo/` — read `docs/promo/README.md` first (storyboard, how to watch it
live, how to render).

1. **Footage**: shoot with the `playtest-screenshots` skill (desktop `1280x800`, phone `390x844`), pick
   frames with real action (a slammed banner, a burst, a full board), convert to WebP
   (Pillow: `im.convert('RGB').save(p, 'WEBP', quality=88, method=6)`) into `docs/promo/assets/`
   using the names in `SHOTS` (`m-*` desktop, `p-*` phone) or add new entries.
2. **Timeline**: `promo.html` is a pure function of `t` (`window.__seek`). Keep cuts on the beat grid
   (`beat(n)` / `bar(n)` helpers: 140 BPM, first beat 0.357 s). The montage gives each shot 2 beats
   (16 shots = bars 8–15); moving that range means shifting the later scenes and `CUTS` too.
   Pixel-font sizes: multiples of 8 px (crisp Press Start 2P).
3. **Preview** composition with stills before a full render:
   `bun render.ts <repo> prev.png --scale=1 --stills=3.3,15,29.6` (from the puppeteer work folder —
   see README), then look at the PNGs.
4. **Render**: `bun render.ts <repo> pixel-party-promo.mp4 --fps=30 --scale=1.5` (1080p, ~3–5 min),
   then check it with `ffprobe` (duration ≈ 42 s, h264 + aac) and a few extracted frames
   (`ffmpeg -ss 20 -i out.mp4 -frames:v 1 frame.png`).
