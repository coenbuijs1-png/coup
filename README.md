# Coup — online 2-player

A digital version of the card game **Coup**, playable in the browser with a friend
over the internet. One player creates a room, shares the code, the other joins.

Live: https://coenbuijs1-png.github.io/coup/

## How to play
1. Both players open the link.
2. Player 1: enter a name → **Create room** → share the shown code. Keep the tab open.
3. Player 2: enter a name → **Join room** → paste the code → **Join**.

## Tech
- Pure HTML/CSS/JS, no build step.
- Networking: PeerJS (WebRTC peer-to-peer + its public signaling broker).
- Hosted as a static site on GitHub Pages.

## Files
- `index.html`, `styles.css`
- `js/cards.js` — roles & actions
- `js/game.js` — rules engine (host-authoritative state machine)
- `js/net.js` — PeerJS networking
- `js/ui.js` — rendering
- `js/main.js` — glue
- `cards/` — card art
