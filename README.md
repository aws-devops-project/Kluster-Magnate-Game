# 🧲 Kluster Magnate — Magnetic Strategy Game

A real-time multiplayer physics-based magnetic strategy game built with vanilla JS, Matter.js, and Socket.IO.

---

## ▶ How To Run

### Option A — Instant Local Play (No server needed)

Just open `index.html` **via a local HTTP server** (browsers block file:// for JS modules).

**Using Python (built into most systems):**
```bash
cd "kluster magnate game"
python -m http.server 8080
```
Then open: **http://localhost:8080**

**Using Node.js npx:**
```bash
cd "kluster magnate game"
npx serve .
```

---

### Option B — Full Multiplayer Server

Requires Node.js installed.

```bash
cd "kluster magnate game"
npm install
node server.js
```

Then open: **http://localhost:3001**

The server also **serves the static files** — so both players can play online from the same URL.

---

## 🎮 Game Modes

| Mode | Description |
|------|-------------|
| **Local Match** | 2 players, same screen (pass & play) |
| **Online Match** | Create a room, share code with friend |
| **Practice/Sandbox** | Free play, no rules, experiment with physics |

---

## 🧲 Rules

1. Players take turns placing magnetic stones inside the circular arena
2. Every magnet exerts attraction force on nearby magnets
3. If your placed magnet causes a **chain reaction** (magnets snap together), those magnets **return to you** as a penalty
4. **First player to empty their hand wins!**

---

## 🏗 Architecture

```
index.html        — Game markup & screen layouts
style.css         — Dark glassmorphism design system
audio.js          — Web Audio API synthesized sounds (no files needed!)
game.js           — Matter.js physics engine + canvas rendering
ui.js             — Screen/HUD controller
multiplayer.js    — Socket.IO client
main.js           — Game state machine + event orchestration
server.js         — Node.js + Socket.IO multiplayer server
package.json      — Server dependencies
```

---

## ⚙️ Physics Tuning

Edit constants at the top of `game.js`:

| Constant | Default | Effect |
|----------|---------|--------|
| `MAGNET_RADIUS` | 14px | Visual size of magnets |
| `SNAP_DISTANCE` | 30px | Distance at which magnets "click" together |
| `ATTRACT_RADIUS` | 126px | Range of magnetic influence |
| `MAGNET_STRENGTH` | 0.00028 | Force multiplier |
| `SETTLE_FRAMES` | 80 | How many frames before checking for snaps |

---

## 🌐 Deployment

- **Frontend**: Upload all `.html`, `.css`, `.js` files to Vercel / Netlify / GitHub Pages
- **Backend**: Deploy `server.js` to Railway, Render, or Fly.io — set `PORT` env var
- Update `SERVER_URL` in `multiplayer.js` to your backend URL

---

## 🔊 Audio

All sounds are synthesized in real-time using the **Web Audio API** — no audio files needed:
- Magnetic hum (proximity-based, spatial)
- Sharp metallic snap on collision
- Chain reaction multi-click
- Turn-change chime
- Victory fanfare
