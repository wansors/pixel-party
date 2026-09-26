# Pixel Party — promo video

A ~42 s promotional video built as an HTML page, cut to the game's own soundtrack ("Pixel Party
Panic", `apps/client/public/audio/background-song.mp3`; 140 BPM, first beat at 0.357 s — every cut
lands on the beat grid).

| File | What |
|------|------|
| `promo.html` | The video. Every frame is a pure function of the timeline position (`window.__seek(t)`), so it plays live in a browser and renders deterministically. |
| `assets/*.webp` | Real in-game screenshots (desktop 1280x800, phone 390x844) captured with the `playtest-screenshots` skill. |
| `render.ts` | Headless-Chrome → ffmpeg renderer (MP4 with the soundtrack, or single stills). |
| `pixel-party-promo.mp4` | Rendered master: 1920x1080, 30 fps, h264 CRF 18 + AAC, 41.8 s (~24 MB). |
| `pixel-party-promo-share.mp4` | Lighter copy for chats/social (CRF 24, ~12 MB). |
| `poster.png` | 1080p thumbnail (logo + tagline frame). |
| `preview.gif` | ~7 s looping montage (640x360, 10 fps) used as the hero image of the repo README. |

To refresh the README preview after a re-render:

```bash
ffmpeg -y -ss 14.07 -t 6.86 -i pixel-party-promo.mp4 -vf "fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" preview.gif
```

## Storyboard (in bars of 1.714 s)

| Bars | Scene |
|------|-------|
| 0–1 | CRT power-on, INSERT COIN, the logo drops in letter by letter |
| 2–3 | Tagline types on, pixel confetti |
| 4–5 | "Grab your phone. Join with a code." — phone mockup, room code typing |
| 6–7 | "The host picks the line-up" — laptop mockup of the lobby, 35 counter |
| 8–15 | Montage: 16 games, one cut every 2 beats, each with a slammed shout word; "+19 more games" |
| 16–17 | Every way to play: free-for-all / team battles / 1v1 duels |
| 18–19 | Climb the standings → crown the champion (results + podium) |
| 20–21 | Built for LAN parties: 8 feature chips popping on the beat |
| 22–23 | End card: logo, PRESS START, `bun install && bun run dev`, fade out |

## Watch it live

Chrome refuses web fonts from `file://`, so serve the repo root and open the page:

```bash
python3 -m http.server 8123          # from the repo root
# → http://localhost:8123/docs/promo/promo.html  (press ▶ PLAY; audio starts on the click)
```

## Render the MP4

`render.ts` needs `puppeteer-core` (not a project dependency) and ffmpeg. Reuse the playtest driver's
work folder (see `.claude/skills/playtest-screenshots/SKILL.md`):

```bash
WORK="${TMPDIR:-/tmp}/pp-playtest"; mkdir -p "$WORK"
cd "$WORK" && [ -d node_modules/puppeteer-core ] || { echo '{"private":true}' > package.json; bun add puppeteer-core@23; }
cp <repo>/docs/promo/render.ts "$WORK/"
bun render.ts <repo> pixel-party-promo.mp4 --fps=30 --scale=1.5     # 1920x1080, ~3–5 min
bun render.ts <repo> preview.png --scale=1 --stills=3.3,15,29.6      # quick composition check
```

## Updating the footage

Shoot fresh screenshots with the `playtest-screenshots` skill (desktop `1280x800`, phone `390x844`),
convert the ones you want to WebP into `assets/` (the montage expects the names listed in `SHOTS` in
`promo.html`; phone shots are the `p-*` files and render inside the phone mockup), then re-render.
To add or reorder montage shots, edit `SHOTS` — each one lasts 2 beats, so keep the list at 16 or
change the montage's bar range together with the scenes after it.
