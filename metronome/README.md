# Metronome

A plain-JavaScript metronome whose tempo moves only along the traditional mechanical markings (40, 42 … 120 … 208). Built for a slow-ramp practice routine: start low, then press **Next step** to climb one marking at a time to your target.

## Using it

- **Start / Stop** — the large button. Keyboard: Space.
- **Slower / Faster** — one marking at a time. Keyboard: arrow keys.
- **Pick a tempo** — tap the big number to open the tempo list (a wheel on iPhone) and choose any of the 39 markings.
- **Recent tempi** — a tempo you play for 30 seconds without a change appears below Slower and Faster. Tap one to go back to it. Nothing is recorded during a ramp.
- **Practice ramp** — by default the ramp target follows the tempo and the start is 4 markings below it. Press **Start ramp** to freeze the start and target and move to the start. Then use **Next step** and **Back to start**, and press **End ramp** when you finish. Flames burn on both sides of the tempo while a ramp is running. Keyboard: Home returns to the start during a ramp.
- **Subdivision** — off by default. Choose 8ths, triplets, or 16ths when you want them.
- **Ignore repeat taps for** — keeps a shaky second tap from skipping a marking or stopping playback.

Everything is sized for phone use with big targets and no sliders. Settings and your place in the ramp are saved in this browser.

Notes: on iPhone it plays through the speaker even with the silent switch on, like a music app. Playback keeps the screen awake where the browser supports it.

See [`for_claude/metronome.md`](../for_claude/metronome.md) (agent guidance) and [`wiki/metronome.md`](../wiki/metronome.md) (reference).
