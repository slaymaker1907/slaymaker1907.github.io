# Metronome

A plain-JavaScript metronome whose tempo moves only along the traditional mechanical markings (40, 42 … 120 … 208). Built for a slow-ramp practice routine: start low, then press **Next step** to climb one marking at a time to your target.

## Using it

- **Start / Stop** — the large button. Keyboard: Space.
- **Slower / Faster** — one marking at a time. Keyboard: arrow keys.
- **Type a tempo** — press and hold the big number, type a value, and press Enter. Values that are not markings round up to the next one (61 becomes 63).
- **Practice ramp** — pick a start and target marking, then use **Next step** and **Back to start**. Keyboard: Home returns to the start.
- **Subdivision** — off by default. Choose 8ths, triplets, or 16ths when you want them.
- **Ignore repeat taps for** — keeps a shaky second tap from skipping a marking or stopping playback.

Everything is sized for phone use with big targets and no sliders. Settings and your place in the ramp are saved in this browser.

Notes: iPhone's silent switch can mute the sound. Playback keeps the screen awake where the browser supports it.

See [`for_claude/metronome.md`](../for_claude/metronome.md) (agent guidance) and [`wiki/metronome.md`](../wiki/metronome.md) (reference).
