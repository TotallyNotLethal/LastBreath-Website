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

> Vercel note: the API runs as serverless functions, not a persistent background process. SQLite is automatically stored in `/tmp/lastbreath.db` on Vercel so routes work, but `/tmp` is ephemeral. For durable production data, set `DB_PATH` to persistent storage or migrate to a managed DB.

---


## Blob source of truth

Leaderboard and player/server state are sourced from Vercel Blob.

- Configure `BLOB_READ_WRITE_TOKEN` in the API environment.
- Plugin POST endpoints are enabled and server writes are persisted to Blob (`player-data/lastbreath-data.json` by default).
- Frontend leaderboard reads are served from Blob-hydrated state.

---

## API Authentication (Plugin)

For quick testing, the API key defaults in `backend/app.js` (override with `LASTBREATH_API_KEY`):

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
- `GET /api/minecraft/status`
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

```json
{
  "event": "bulk_stats",
  "players": [
    {
      "uuid": "11111111-1111-1111-1111-111111111111",
      "username": "PlayerOne",
      "nickname": "Nick",
      "time_alive": 987654,
      "deaths": 2,
      "revives": 1,
      "mobs_killed": 130,
      "asteroid_loots": 7,
      "crops_harvested": 410,
      "blocks_mined": 8000,
      "blocks_placed": 2600,
      "fish_caught": 45,
      "player_kills": 3,
      "rare_ores_mined": 91,
      "world_scaler_enabled": true,
      "unlocked_titles": ["SURVIVOR", "VOID_WALKER"],
      "equipped_title": "SURVIVOR",
      "unlocked_prefixes": ["ALPHA"],
      "equipped_prefix": "ALPHA",
      "unlocked_auras": ["SHADOW"],
      "equipped_aura": "SHADOW",
      "unlocked_kill_messages": ["REAPER"],
      "equipped_kill_message": "REAPER",
      "is_alive": false
    }
  ]
}
```

`survival_time` is stored in **minutes**.

`time_alive` is expected in **ticks** (20 ticks = 1 second), matching the Minecraft plugin model.

You can also bulk-import directly through:

- `POST /api/players/bulk` with body:

```json
{ "players": [/* same full player objects as above */] }
```

---

## Prompt to give Codex for your Minecraft plugin integration

Copy/paste this prompt into Codex in your plugin repo:

```text
I have a Minecraft plugin (Paper/Spigot) and need a production-ready API integration for my website backend.

Use these exact API details:

- Production website: https://www.lastbreath.net
- API base URL (preferred): https://www.lastbreath.net/api
- API base URL (also valid): https://lastbreath.net/api
- Unified plugin endpoint: POST /plugin/event
- Full endpoint URL to call: https://www.lastbreath.net/api/plugin/event
- API key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME

Authentication headers (send both on every request):
- Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME
- x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME

Content-Type:
- application/json

Implement/verify these methods in the plugin:
- sendJoin(UUID uuid, String username)
- sendLeave(UUID uuid)
- sendDeath(UUID uuid, String deathMessage)
- sendStats(UUID uuid, long survivalMinutes, int kills)
- sendDragon(Optional<UUID> uuid)

Each method should POST to /plugin/event using these JSON payload shapes:

1) Join event
{
  "event": "join",
  "uuid": "<player-uuid>",
  "username": "<player-name>"
}

2) Leave event
{
  "event": "leave",
  "uuid": "<player-uuid>"
}

3) Death event
{
  "event": "death",
  "uuid": "<player-uuid>",
  "death_message": "<minecraft death message>"
}

4) Stats event
{
  "event": "stats",
  "uuid": "<player-uuid>",
  "survival_time": <minutes>,
  "kills": <int>
}

5) Dragon event (with killer)
{
  "event": "dragon",
  "uuid": "<killer-uuid>"
}

6) Dragon event (no killer)
{
  "event": "dragon"
}

Expected successful response:
- HTTP 200
- JSON like: {"success":true,"message":"<event> event processed"}

Error behavior to handle:
- 400 when required fields are missing
- 401 when API key is missing/incorrect
- 429 if rate limited
- 5xx for server issues

Implementation requirements:
- Use Java HttpClient asynchronously (sendAsync) so Bukkit main thread is never blocked.
- Add retries with exponential backoff (minimum 3 attempts).
- Log request URL, event type, status code, and truncated response body for non-2xx.
- Escape JSON string fields safely (username/death_message).
- Add config values in config.yml:
  - lastbreath.api.baseUrl: https://www.lastbreath.net
  - lastbreath.api.apiKey: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME
- Normalize base URL so final request path is always /api/plugin/event.
- Enable redirects in HttpClient (followRedirects NORMAL) in case of domain redirect.

Wire event hooks:
- PlayerJoinEvent -> sendJoin
- PlayerQuitEvent -> sendLeave
- PlayerDeathEvent -> sendDeath
- EnderDragon death -> sendDragon(Optional killer UUID)
- Scheduled repeating task (e.g., every 60s) to sendStats for online players

Also add one startup self-test log message that prints the fully resolved URL being used for plugin events.

Return complete compilable code for all changed classes and any dependency/config updates.
```

---

## Quick curl test

```bash
curl -X POST https://lastbreath.net/api/plugin/event \
  -H "Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "Content-Type: application/json" \
  -d '{"event":"join","uuid":"123e4567-e89b-12d3-a456-426614174000","username":"TestPlayer"}'
```

## Proper POST requests to send data

Use `POST /api/plugin/event` with both auth headers:

- `Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME`
- `x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME`

### Join

```bash
curl -X POST https://lastbreath.net/api/plugin/event \
  -H "Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "Content-Type: application/json" \
  -d '{"event":"join","uuid":"123e4567-e89b-12d3-a456-426614174000","username":"TestPlayer"}'
```

### Leave

```bash
curl -X POST https://lastbreath.net/api/plugin/event \
  -H "Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "Content-Type: application/json" \
  -d '{"event":"leave","uuid":"123e4567-e89b-12d3-a456-426614174000"}'
```

### Death

```bash
curl -X POST https://lastbreath.net/api/plugin/event \
  -H "Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "Content-Type: application/json" \
  -d '{"event":"death","uuid":"123e4567-e89b-12d3-a456-426614174000","death_message":"TestPlayer was blown up by Creeper"}'
```

### Stats

```bash
curl -X POST https://lastbreath.net/api/plugin/event \
  -H "Authorization: Bearer LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "x-api-key: LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME" \
  -H "Content-Type: application/json" \
  -d '{"event":"stats","uuid":"123e4567-e89b-12d3-a456-426614174000","survival_time":3456,"kills":22}'
```
