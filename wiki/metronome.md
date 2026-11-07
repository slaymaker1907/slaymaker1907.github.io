# Metronome — reference

The `metronome/` app is a plain-JS metronome for practice. Its tempo moves only along the traditional mechanical (Maelzel) markings, so a practice session can start low and climb one marking at a time to a target.

## Tempo ladder

The 39 markings, from slowest to fastest:

40 42 44 46 48 50 52 54 56 58 60 · 63 66 69 72 · 76 80 84 88 92 96 100 104 108 112 116 120 · 126 132 138 144 · 152 160 168 176 184 192 200 208

Each tempo carries an Italian term. These are the bands used:

| BPM | Term |
| --- | --- |
| 40–45 | Grave |
| 46–59 | Largo |
| 60–65 | Larghetto |
| 66–75 | Adagio |
| 76–107 | Andante |
| 108–119 | Moderato |
| 120–167 | Allegro |
| 168–199 | Presto |
| 200–208 | Prestissimo |

## Practice ramp

Ramp mode is explicit. It is off by default.

- **Outside ramp mode** the target follows the current tempo, and the start is 4 markings below it. Picking a tempo changes both. Picking a Start sticks until the tempo next changes. Picking a Target sets the tempo.
- **Start ramp** turns ramp mode on. The tempo jumps to the start, the start and target are frozen, and playback is left alone.
- In ramp mode, **Next step** moves one marking toward the target and stops there. **Back to start** returns to the start marking. The progress bar and text show markings remaining, or "Target reached". Start and Target can still be edited.
- **End ramp** turns ramp mode off. The start and target re-derive from the current tempo.
- The tempo panel gets a `ramp-active` class, and the marking line reads "Marking 14 of 39 · Ramp mode". Small animated flames appear on both sides of the tempo block, and its border turns orange. The flames hold still if the device asks for reduced motion.
- A ramp can go downward if the target is below the start.

## Recent tempi

Below Slower and Faster is a **Recent tempi** row of large buttons, one per tempo, most recent first. A tempo is added only after the metronome has been playing continuously at that tempo for 30 seconds. Playing continuously means that changing the tempo, or stopping, restarts the count. Nothing is added in ramp mode. The list keeps 6 tempi, with no duplicates. The current tempo's button is filled maroon. Tapping a button sets that tempo.

## Settings

| Setting | Default | Choices |
| --- | --- | --- |
| Beats per bar | 4 | 1–12 |
| Accent first beat | on | on / off |
| Subdivision | **Off** | Off, 8ths, Triplets, 16ths |
| Sound | Wood | Wood, Beep, Soft |
| Volume | 3 | 1–4 |
| Ignore repeat taps for | 0.4 s | off, 0.25 s, 0.4 s, 0.7 s |

Subdivision clicks play at about a third of the beat level, so they sit underneath the beat.

## Storage format

One `localStorage` entry, key `metronome-v1:settings`, holds a JSON object:

```json
{
  "rung": 10,
  "rampMode": false,
  "rampStart": 6,
  "rampTarget": 10,
  "recent": [],
  "beatsPerBar": 4,
  "accent": true,
  "subdivision": "off",
  "sound": "wood",
  "volume": 3,
  "guardMs": 400
}
```

`rung`, `rampStart`, `rampTarget`, and the entries of `recent` are indices into the ladder above, not BPM values. `recent` lists up to 6 tempi, most recent first. `rampMode` is `true` while a ramp is running. Outside a ramp, `rampTarget` always equals `rung`, and `rampStart` is 4 markings below it unless a Start was picked and the tempo has not changed since. On load, every field is validated and falls back to its default. Storage can be blocked in private browsing, and the app still runs without it.

## UI flow

1. The big **Start** button starts playback. Clicks are scheduled with Web Audio. The first Start unlocks audio on iOS. While playing, the beat dots light up, and the screen is kept awake where the Screen Wake Lock API exists.
2. **Slower** and **Faster** move one marking each, and the tempo is announced to screen readers.
2a. **Picking a tempo:** tap the large number. It opens the native picker (a wheel on iPhone) listing all 39 markings as "BPM · term". Choosing one sets the tempo. Keyboard users can focus the number and use the arrow keys in the picker.
3. **Start ramp**, **Next step**, **Back to start**, and **End ramp** drive the practice ramp (see above).
4. Repeated taps on the same control within the chosen guard window are ignored.
5. Keyboard: Space starts or stops, arrow keys step, Home returns to the ramp start while ramp mode is on.

On iPhone, the hardware silent switch can mute Web Audio output.

## Where it is listed

The app is reachable at `/metronome/`, and it also appears on the site homepage. The homepage gallery is built from `_data/apps.yml`, which holds the Metronome entry under the Music category.
