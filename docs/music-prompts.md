# Music prompts (Suno) — Pixel Party soundtrack

Prompts for the extra songs the soundtrack needs (D32). Each track serves one of the director's
moods. Tracks of the same mood alternate from round to round, so the game lists below are examples of
where each will be heard (the mapping lives in `apps/client/src/game/musicMoods.ts`). The theme, **"Pixel Party Panic"**, already
plays on the join screen, in the lobby and on the final podium. Rounds and round results currently
play synthesized chiptune loops picked by the game's mood (`apps/client/src/game/musicMoods.ts`).
Produced songs in the same family as the theme would sound better. This file lists one or two per
mood, ready to paste into Suno's **Custom** mode.

## How to use

- **Custom mode** fields: *Song title* ← **Title**, *Style of music* ← **Style**, *Lyrics* ← **Lyrics
  field**, *Exclude styles* ← **Exclude**. Set *Instrumental* where the track says so.
- **Keep the family sound.** If the theme's original style prompt is still in your Suno library,
  prepend its key words to each style below, or use the theme as a reference (Cover / Persona), so
  every track sounds like the same game.
- **Generate 2–4 takes per track** and keep the one that:
  - holds a steady tempo with no slow intro;
  - has no vocals where it's marked instrumental;
  - ends on a hard stop rather than a fade-out.

  Trim leading silence and any fade.
- **Export**: download the MP3, then re-encode to **128 kbps** and normalise to roughly the theme's
  loudness (about −14 LUFS) so a LAN party downloads little and nothing jumps out:
  `ffmpeg -i in.mp3 -af loudnorm=I=-14:TP=-1.5 -b:a 128k out.mp3`.
- **Where they go**: `apps/client/public/audio/<file>.mp3`, using the file names below. Playing them
  needs the pending backlog item "a per-mood mp3 list in the music director". Until that lands, the
  synthesized loops keep playing.
- **Rounds are short** (15–100 s) and the results screen only lasts ~8 s, so tracks resume where
  they left off rather than restarting. That's why round tracks ask for 2–3 minutes of material with
  no long intro, and why the results track is a short, catchy loop.

## Tracks

### 1. Action A — arcade, real-time games
Mood **action**, e.g. Fruit Catch, Pixel Rain, Bug Smash, Pang, Star Blaster, Asteroids, Bomber,
Brawl, Sumo, Pixel Pong, Number Rush and the team mash games.
- **Title**: Turbo Pixels
- **Style**: `upbeat chiptune rock, 8-bit arcade, 150 bpm, driving square-wave lead, punchy bass, energetic drums, video game boss-rush energy, catchy, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Short Intro]
  [Main Riff]
  [Lead Melody]
  [Main Riff]
  [Bridge]
  [Lead Melody]
  [Main Riff]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, choir, slow intro, fade out, ballad, lo-fi`
- **File**: `round-action-1.mp3` · **Length**: 2–3 min · **Instrumental**: yes

### 2. Action B — faster, racing flavour
Mood **action**, alternating with Action A. Shines under Micro Race, Rally Stage, Speed Circuit, the
track & field events, Room Rush and Snake.
- **Title**: Neon Grand Prix
- **Style**: `fast eurobeat chiptune, 8-bit racing game, 165 bpm, bright synth arpeggios, four-on-the-floor kick, rolling bassline, adrenaline, retro arcade racer, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Countdown Intro]
  [Main Theme]
  [Arpeggio Section]
  [Main Theme]
  [Breakdown]
  [Final Lap Build-up]
  [Main Theme]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, slow tempo, fade out, ambient, orchestral`
- **File**: `round-action-2.mp3` · **Length**: 2–3 min · **Instrumental**: yes

### 3. Think A — quizzes
Mood **think**, e.g. Lightning Quiz, Weird Trivia, Quick Math and Color Trap.
- **Title**: Brain Bytes
- **Style**: `playful game show chiptune, 8-bit quiz music, 100 bpm, bouncy pizzicato-like square lead, light jazzy chords, ticking hi-hats, curious and cheeky, keeps you thinking, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Short Intro]
  [Main Theme]
  [Thinking Groove]
  [Main Theme]
  [Variation]
  [Thinking Groove]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, heavy drums, distorted guitar, fade out, dramatic`
- **File**: `round-think-1.mp3` · **Length**: 2–3 min · **Instrumental**: yes

### 4. Think B — puzzles
Mood **think**, alternating with Think A, e.g. Sudoku Race, Match, Memory Flash, Pixel Weight, Maze
Sprint, Bubble Pop and the naval games.
- **Title**: Puzzle Cartridge
- **Style**: `calm focused chiptune, 8-bit puzzle game, 92 bpm, warm triangle bass, soft arpeggiated square chords, gentle beat, Tetris-like concentration, light and optimistic, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Intro]
  [Main Theme]
  [Arpeggio Interlude]
  [Main Theme]
  [Variation]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, aggressive drums, fast tempo, fade out, dark`
- **File**: `round-think-2.mp3` · **Length**: 2–3 min · **Instrumental**: yes

### 5. Tension A — nerve and elimination games
Mood **tension**, e.g. Glass Bridge, Balloon Chicken, Higher or Lower, Honeycomb Cut, Stop the Clock,
Pixel Roulette and Reaction Duel.
- **Title**: Glass Nerves
- **Style**: `suspenseful minimal chiptune, 8-bit thriller, 112 bpm, heartbeat kick, low pulsing bass, sparse eerie square-wave melody, ticking clock, rising tension, squid-game-like dread but playful, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Heartbeat Intro]
  [Tension Loop]
  [Eerie Melody]
  [Tension Loop]
  [Rising Build]
  [Tension Loop]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, happy major key, fast drums, fade out, orchestral swell`
- **File**: `round-tension-1.mp3` · **Length**: 2–3 min · **Instrumental**: yes

### 6. Tension B — standoffs
Mood **tension**, alternating with Tension A. Fits Quick Draw and Marbles Duel best.
- **Title**: High Noon Pixels
- **Style**: `spaghetti western chiptune, 8-bit standoff, 96 bpm, twangy square lead, whistled melody on a pulse wave, slow galloping rhythm, tense and cheeky, retro arcade duel, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Lonely Intro]
  [Standoff Theme]
  [Whistle Melody]
  [Standoff Theme]
  [Tense Bridge]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, modern pop, heavy bass drop, fade out`
- **File**: `round-tension-2.mp3` · **Length**: 2 min · **Instrumental**: yes

### 7. Results — the round's result and standings
Heard in ~8 s slices between rounds, so it should grab you immediately.
- **Title**: Score Tally
- **Style**: `bright victorious chiptune jingle, 8-bit results screen, 128 bpm, catchy major-key hook from the first bar, bouncy bass, celebratory drums, short and loopable, no vocals`
- **Lyrics field**:
  ```
  [Instrumental]
  [Hook]
  [Hook Variation]
  [Hook]
  [Hard Stop]
  ```
- **Exclude**: `vocals, singing, slow intro, fade out, minor key, ambient`
- **File**: `results.mp3` · **Length**: 60–90 s · **Instrumental**: yes

### 8. Final podium — optional second anthem
The theme already plays here. Use this one to alternate between sessions or for a big finish.
- **Title**: Champion of the Pixels
- **Style**: `triumphant chiptune anthem, 8-bit victory fanfare, 120 bpm, heroic square-wave lead, big drums, uplifting chord progression, celebratory, stadium-sized retro game ending, catchy chant-along hook`
- **Lyrics field** (works as an instrumental too; tick *Instrumental* if you prefer no words):
  ```
  [Fanfare Intro]
  [Verse]
  Twelve of us came, only one takes the crown
  Pixel by pixel we tore the arcade down
  [Chorus]
  Champion! Champion of the pixels tonight
  Champion! Shine on the scoreboard light
  [Instrumental Break]
  [Chorus]
  [Big Ending]
  ```
- **Exclude**: `slow ballad, sad, lo-fi, fade out`
- **File**: `final-anthem.mp3` · **Length**: 1.5–2.5 min

## Spanish-flavoured alternatives (optional)

The party is Spanish. A few takes with local colour can be fun as extra variants. Keep them
instrumental during rounds.
- **Think, "verbena" quiz**:
  `chiptune pasodoble, 8-bit Spanish fair music, 100 bpm, playful brass-like square lead, festive and cheeky, game show, no vocals`
- **Tension, flamenco standoff**:
  `chiptune flamenco, 8-bit, 108 bpm, rhythmic palmas on noise channel, phrygian square-wave lead, tense and dramatic, no vocals`
- **Final, "fiesta"**:
  `chiptune rumba, 8-bit Spanish party anthem, 118 bpm, joyful, handclaps, catchy hook, festive ending`.
  With vocals, put Spanish lyrics in the Lyrics field.

## Checklist before adding a track

- [ ] Steady tempo, no slow intro, hard stop (no fade).
- [ ] No vocals in the round tracks.
- [ ] Sits well under the SFX: play a round with sound effects on and check the hits, shots and
      "correct" chimes still cut through.
- [ ] Re-encoded to 128 kbps and loudness-matched to the theme.
- [ ] Saved as `apps/client/public/audio/<file>.mp3` with the names above.
