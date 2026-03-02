# Last Breath API Backend

Backend API for the Last Breath Hardcore Minecraft Server website.

**Game Mode:** Hardcore with limited respawns - players can craft respawn items after defeating asteroids and collecting rare materials. Griefing and alt accounts are allowed.

## Features

- 🎮 Real-time player tracking (join/leave/death events)
- 🏆 Live leaderboard with survival time rankings
- 💀 Death tracking with permanent stats
- 🐉 Dragon slayer counter
- 🗄️ SQLite database (no external DB needed)
- 🔒 API key authentication for Minecraft server integration
- ⚡ Lightweight and fast

## Local Development Setup

### Prerequisites

- Node.js 18+ installed
- npm or yarn

### 1) Install dependencies

```bash
cd backend
npm install
```

### 2) Start API

```bash
npm run start
```

API will run on `http://localhost:3000` locally. Production is hosted at `https://lastbreath.net`.

---

## API Authentication (Plugin)

For quick testing, the API key is currently hardcoded in `backend/server.js`:

- `LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME`

Send this either as:

- `Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME`
- or `x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME`

---

## Endpoints your plugin can call

### Public (website/frontend)

- `GET /api/leaderboard?limit=10`
- `GET /api/stats`
- `GET /api/state`
- `GET /api/states`
- `GET /api/player/:username`
- `GET /api/search?q=Name`
- `GET /api/health`

### Protected (Minecraft plugin)

- `POST /api/player/join`
- `POST /api/player/leave`
- `POST /api/player/death`
- `POST /api/player/stats`
- `POST /api/server/dragon`
- `POST /api/plugin/event` (recommended unified endpoint)

---

## Unified plugin endpoint format

### `POST /api/plugin/event`

Body examples:

```json
{ "event": "join", "uuid": "uuid-here", "username": "PlayerName" }
```

```json
{ "event": "leave", "uuid": "uuid-here" }
```

```json
{ "event": "death", "uuid": "uuid-here", "death_message": "PlayerName was blown up by Creeper" }
```

```json
{ "event": "dragon", "uuid": "uuid-here" }
```

```json
{ "event": "stats", "uuid": "uuid-here", "survival_time": 12345, "kills": 22 }
```

`survival_time` is stored in **minutes**.

---

## Prompt to give Codex for your Minecraft plugin integration

Copy/paste this prompt into Codex in your plugin repo:

```text
I have a Minecraft plugin (Paper/Spigot). Add an async API client service that pushes events to my Last Breath API.

Base URL: https://lastbreath.net/api
API key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME
Auth header: Authorization: Bearer <API_KEY>
Fallback header also accepted: x-api-key

Implement these methods:
- sendJoin(UUID uuid, String username) -> POST /plugin/event with {event:"join", uuid, username}
- sendLeave(UUID uuid) -> POST /plugin/event with {event:"leave", uuid}
- sendDeath(UUID uuid, String deathMessage) -> POST /plugin/event with {event:"death", uuid, death_message}
- sendStats(UUID uuid, long survivalMinutes, int kills) -> POST /plugin/event with {event:"stats", uuid, survival_time, kills}
- sendDragon(Optional<UUID> uuid) -> POST /plugin/event with {event:"dragon", uuid?}

Requirements:
- Use asynchronous HTTP (non-blocking main server thread).
- Retry with backoff (at least 3 attempts).
- Log non-2xx responses with endpoint and body.
- Add config values for baseUrl and apiKey in config.yml.
- Add a scheduled task to send periodic stats updates for online players.
- Hook PlayerJoinEvent, PlayerQuitEvent, PlayerDeathEvent, and EnderDragon death event.
- Keep code organized with ApiClient class + EventListener class.
- Include full compilable code and any needed Gradle/Maven dependency changes.
```

---

## Quick curl test

```bash
curl -X POST https://lastbreath.net/api/plugin/event \
  -H "Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "Content-Type: application/json" \
  -d '{"event":"join","uuid":"123e4567-e89b-12d3-a456-426614174000","username":"TestPlayer"}'
```
