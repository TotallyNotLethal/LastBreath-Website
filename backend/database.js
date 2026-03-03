const fs = require('fs');
const path = require('path');
const { get, put } = require('@vercel/blob');

const runtimeDbPath = process.env.DB_PATH || path.join(__dirname, 'lastbreath-data.json');
const DB_PATH = path.resolve(runtimeDbPath);
const DB_BACKUP_PATH = `${DB_PATH}.bak`;


const BLOB_PATHNAME = process.env.BLOB_DB_PATHNAME || 'player-data/lastbreath-data.json';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_SYNC_ENABLED = Boolean(BLOB_TOKEN);

let fsPersistenceAvailable = true;

try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (error) {
  fsPersistenceAvailable = false;
  console.warn(`Filesystem persistence disabled (failed creating DB directory at ${DB_PATH}):`, error?.message || error);
}

class Database {
  constructor() {
    this.state = {
      players: [],
      sessions: [],
      server_stats: {
        total_deaths: 0,
        online_players: 0,
        dragon_slayers: 0,
        server_uptime: 0,
        updated_at: new Date().toISOString()
      }
    };

    this.usernameLookupCache = new Map();
    this.lastBlobHydrationAt = 0;
    this.load();
    this.refreshDerivedStats();
    this.ready = this.hydrateFromBlob();
    console.log(`Connected to JSON database at ${DB_PATH}`);
  }

  async hydrateFromBlob() {
    if (!BLOB_SYNC_ENABLED) {
      return;
    }

    try {
      const blobResponse = await get(BLOB_PATHNAME, {
        access: 'private',
        useCache: false,
        token: BLOB_TOKEN
      });

      if (!blobResponse || blobResponse.statusCode !== 200 || !blobResponse.stream) {
        return;
      }

      const blobText = await new Response(blobResponse.stream).text();
      if (!blobText.trim()) {
        return;
      }

      const parsed = JSON.parse(blobText);
      this.state = this.buildStateFromParsed(parsed);
      this.refreshDerivedStats();
      this.lastBlobHydrationAt = Date.now();
      this.persist(false);
      console.log(`Hydrated JSON database from Vercel Blob path: ${BLOB_PATHNAME}`);
    } catch (error) {
      if (error?.name === 'BlobNotFoundError') {
        console.log(`No Blob dataset found at ${BLOB_PATHNAME}. Continuing with local JSON state.`);
      } else {
        console.warn('Failed to hydrate database from Vercel Blob:', error?.message || error);
      }
    }
  }

  async syncStateToBlob(serializedState) {
    if (!BLOB_SYNC_ENABLED) {
      return;
    }

    try {
      const blob = await put(BLOB_PATHNAME, serializedState, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        token: BLOB_TOKEN
      });
      this.lastBlobUrl = blob.url;
    } catch (error) {
      console.warn('Failed syncing JSON database to Vercel Blob:', error?.message || error);
    }
  }

  async ensureLatestBlobState() {
    if (!BLOB_SYNC_ENABLED) {
      return;
    }

    await this.hydrateFromBlob();
  }

  async resolveUsernameFromUUID(uuid) {
    const normalizedUuid = String(uuid || '').replace(/-/g, '').trim();
    if (!normalizedUuid) return null;

    if (this.usernameLookupCache.has(normalizedUuid)) {
      return this.usernameLookupCache.get(normalizedUuid);
    }

    try {
      const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(normalizedUuid)}`);
      if (!response.ok) {
        this.usernameLookupCache.set(normalizedUuid, null);
        return null;
      }

      const profile = await response.json();
      const username = typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : null;
      this.usernameLookupCache.set(normalizedUuid, username);
      return username;
    } catch (error) {
      console.warn(`Failed to resolve username for UUID ${normalizedUuid}:`, error?.message || error);
      return null;
    }
  }

  refreshDerivedStats() {
    const totalDeaths = this.state.players.reduce((sum, player) => {
      return sum + (Number(player.deaths) || 0);
    }, 0);

    this.state.server_stats.total_deaths = totalDeaths;
    this.updateOnlineCount();
  }

  buildDefaultPlayer(uuid, username = 'Unknown Player') {
    return {
      id: this.state.players.length + 1,
      uuid,
      username,
      nickname: null,
      time_alive_ticks: 0,
      survival_time: 0,
      deaths: 0,
      revives: 0,
      mobs_killed: 0,
      asteroid_loots: 0,
      crops_harvested: 0,
      blocks_mined: 0,
      blocks_placed: 0,
      fish_caught: 0,
      player_kills: 0,
      rare_ores_mined: 0,
      world_scaler_enabled: false,
      unlocked_titles: [],
      equipped_title: null,
      unlocked_prefixes: [],
      equipped_prefix: null,
      unlocked_auras: [],
      equipped_aura: null,
      unlocked_kill_messages: [],
      equipped_kill_message: null,
      is_alive: 1,
      last_login: new Date().toISOString(),
      created_at: new Date().toISOString(),
      avatar_url: null,
      join_date: new Date().toISOString().split('T')[0]
    };
  }

  normalizePlayer(player) {
    return {
      ...this.buildDefaultPlayer(player.uuid, player.username),
      ...player,
      username: player.username || player.nickname || 'Unknown Player',
      nickname: player.nickname || null,
      unlocked_titles: Array.isArray(player.unlocked_titles) ? player.unlocked_titles : [],
      unlocked_prefixes: Array.isArray(player.unlocked_prefixes) ? player.unlocked_prefixes : [],
      unlocked_auras: Array.isArray(player.unlocked_auras) ? player.unlocked_auras : [],
      unlocked_kill_messages: Array.isArray(player.unlocked_kill_messages) ? player.unlocked_kill_messages : []
    };
  }

  load() {
    try {
      if (!fs.existsSync(DB_PATH)) {
        this.persist();
        return;
      }

      const raw = fs.readFileSync(DB_PATH, 'utf8');
      if (!raw.trim()) {
        this.persist();
        return;
      }

      const parsed = JSON.parse(raw);
      this.state = this.buildStateFromParsed(parsed);

      this.refreshDerivedStats();
    } catch (error) {
      console.error('Error loading primary JSON database, attempting backup restore:', error);

      try {
        if (fs.existsSync(DB_BACKUP_PATH)) {
          const backupRaw = fs.readFileSync(DB_BACKUP_PATH, 'utf8');
          if (backupRaw.trim()) {
            const backupParsed = JSON.parse(backupRaw);
            this.state = this.buildStateFromParsed(backupParsed);
            this.refreshDerivedStats();
            this.persist();
            console.log(`Recovered JSON database from backup at ${DB_BACKUP_PATH}`);
            return;
          }
        }
      } catch (backupError) {
        console.error('Backup restore failed, starting fresh state:', backupError);
      }

      this.persist();
    }
  }

  buildStateFromParsed(parsed = {}) {
    return {
      players: Array.isArray(parsed.players) ? parsed.players.map((player) => this.normalizePlayer(player)) : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      server_stats: {
        total_deaths: parsed.server_stats?.total_deaths || 0,
        online_players: parsed.server_stats?.online_players || 0,
        dragon_slayers: parsed.server_stats?.dragon_slayers || 0,
        server_uptime: parsed.server_stats?.server_uptime || 0,
        updated_at: parsed.server_stats?.updated_at || new Date().toISOString()
      }
    };
  }

  async persist(syncBlob = true) {
    this.state.server_stats.updated_at = new Date().toISOString();
    const serialized = JSON.stringify(this.state, null, 2);
    const tempPath = `${DB_PATH}.tmp`;

    if (fsPersistenceAvailable) {
      try {
        fs.writeFileSync(tempPath, serialized, 'utf8');
        fs.renameSync(tempPath, DB_PATH);
        fs.writeFileSync(DB_BACKUP_PATH, serialized, 'utf8');
      } catch (error) {
        fsPersistenceAvailable = false;
        console.warn('Filesystem persistence disabled (writes failed, continuing in-memory/blob-only mode):', error?.message || error);
      }
    }

    if (syncBlob) {
      await this.syncStateToBlob(serialized);
    }
  }

  updateOnlineCount() {
    const openSessions = new Set(
      this.state.sessions
        .filter((session) => session?.player_uuid && !session.logout_time)
        .map((session) => session.player_uuid)
    );

    this.state.server_stats.online_players = openSessions.size;
  }

  async getTopPlayers(limit = 10, metric = 'playtime') {
    await this.ensureLatestBlobState();

    const metricExtractors = {
      playtime: (p) => Number(p.time_alive_ticks || 0),
      mobs_killed: (p) => Number(p.mobs_killed || 0),
      player_kills: (p) => Number(p.player_kills || 0),
      deaths: (p) => Number(p.deaths || 0),
      revives: (p) => Number(p.revives || 0),
      blocks_mined: (p) => Number(p.blocks_mined || 0),
      blocks_placed: (p) => Number(p.blocks_placed || 0),
      rare_ores_mined: (p) => Number(p.rare_ores_mined || 0),
      crops_harvested: (p) => Number(p.crops_harvested || 0),
      fish_caught: (p) => Number(p.fish_caught || 0),
      asteroids_looted: (p) => Number(p.asteroid_loots || 0)
    };
    const extractor = metricExtractors[metric] || metricExtractors.playtime;

    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : this.state.players.length;

    const rows = [...this.state.players]
      .sort((a, b) => (extractor(b) - extractor(a)) || (Number(b.time_alive_ticks || 0) - Number(a.time_alive_ticks || 0)))
      .slice(0, safeLimit)
      .map((p) => ({
        uuid: p.uuid,
        username: p.username,
        nickname: p.nickname,
        time_alive_ticks: p.time_alive_ticks,
        survival_time: p.survival_time,
        kills: p.kills,
        deaths: p.deaths,
        revives: p.revives,
        mobs_killed: p.mobs_killed,
        asteroid_loots: p.asteroid_loots,
        crops_harvested: p.crops_harvested,
        blocks_mined: p.blocks_mined,
        blocks_placed: p.blocks_placed,
        fish_caught: p.fish_caught,
        player_kills: p.player_kills,
        rare_ores_mined: p.rare_ores_mined,
        world_scaler_enabled: p.world_scaler_enabled,
        unlocked_titles: p.unlocked_titles,
        equipped_title: p.equipped_title,
        unlocked_prefixes: p.unlocked_prefixes,
        equipped_prefix: p.equipped_prefix,
        unlocked_auras: p.unlocked_auras,
        equipped_aura: p.equipped_aura,
        unlocked_kill_messages: p.unlocked_kill_messages,
        equipped_kill_message: p.equipped_kill_message,
        is_alive: p.is_alive,
        join_date: p.join_date,
        avatar_url: p.avatar_url,
        leaderboard_value: extractor(p),
        leaderboard_metric: metric,
        status: p.is_alive ? 'Alive' : 'Dead'
      }));

    return rows;
  }

  async getAllPlayers() {
    await this.ensureLatestBlobState();

    const rows = [...this.state.players]
      .sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return aTime - bTime;
      })
      .map((player) => this.normalizePlayer(player));

    return rows;
  }

  async getPlayerByUUID(uuid) {
    await this.ensureLatestBlobState();
    return this.state.players.find((p) => p.uuid === uuid);
  }

  async getPlayerByUsername(username) {
    await this.ensureLatestBlobState();
    const lower = String(username).toLowerCase();
    return this.state.players.find((p) => String(p.username).toLowerCase() === lower);
  }

  async createPlayer(uuid, username) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (existing) return existing.id;

    const player = this.buildDefaultPlayer(uuid, username);

    this.state.players.push(player);
    await this.persist();
    return player.id;
  }

  async upsertPlayer(uuid, username) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (existing) {
      existing.username = username;
      existing.last_login = new Date().toISOString();
      existing.is_alive = Number(existing.deaths || 0) > 0 ? 0 : 1;
      await this.persist();
      return existing.id;
    }
    return await this.createPlayer(uuid, username);
  }

  async updatePlayerStats(uuid, survivalTime = 0, kills = 0) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (!existing) return;

    existing.survival_time = Number(survivalTime) || 0;
    existing.kills = Number(kills) || 0;
    existing.last_login = new Date().toISOString();
    await this.persist();
  }

  async upsertFullPlayerStats(payload = {}) {
    const uuid = payload.uuid;
    if (!uuid) return;

    let existing = this.state.players.find((p) => p.uuid === uuid);
    if (!existing) {
      existing = this.buildDefaultPlayer(uuid, payload.username || payload.nickname || 'Unknown Player');
      this.state.players.push(existing);
    }

    const providedUsername = String(payload.username || payload.nickname || '').trim();
    const hasRealUsername = providedUsername && providedUsername !== 'Unknown Player';
    if (hasRealUsername) {
      existing.username = providedUsername;
      this.usernameLookupCache.set(String(uuid).replace(/-/g, '').trim(), providedUsername);
    } else if (!existing.username || existing.username === 'Unknown Player') {
      // Avoid blocking API writes on external Mojang lookups.
      // We keep the legacy-friendly placeholder and let future payloads overwrite it.
      existing.username = existing.username || 'Unknown Player';
    }
    existing.nickname = payload.nickname ?? existing.nickname;
    existing.time_alive_ticks = Number(payload.time_alive ?? payload.time_alive_ticks ?? existing.time_alive_ticks) || 0;
    existing.survival_time = Math.floor(existing.time_alive_ticks / (20 * 60));
    existing.kills = Number(payload.kills ?? payload.mobs_killed ?? existing.kills) || 0;
    existing.deaths = Number(payload.deaths ?? existing.deaths) || 0;
    existing.revives = Number(payload.revives ?? existing.revives) || 0;
    existing.mobs_killed = Number(payload.mobs_killed ?? existing.mobs_killed) || 0;
    existing.asteroid_loots = Number(payload.asteroid_loots ?? existing.asteroid_loots) || 0;
    existing.crops_harvested = Number(payload.crops_harvested ?? existing.crops_harvested) || 0;
    existing.blocks_mined = Number(payload.blocks_mined ?? existing.blocks_mined) || 0;
    existing.blocks_placed = Number(payload.blocks_placed ?? existing.blocks_placed) || 0;
    existing.fish_caught = Number(payload.fish_caught ?? existing.fish_caught) || 0;
    existing.player_kills = Number(payload.player_kills ?? existing.player_kills) || 0;
    existing.rare_ores_mined = Number(payload.rare_ores_mined ?? existing.rare_ores_mined) || 0;
    existing.world_scaler_enabled = Boolean(payload.world_scaler_enabled ?? existing.world_scaler_enabled);
    existing.unlocked_titles = Array.isArray(payload.unlocked_titles) ? payload.unlocked_titles : existing.unlocked_titles;
    existing.equipped_title = payload.equipped_title ?? existing.equipped_title;
    existing.unlocked_prefixes = Array.isArray(payload.unlocked_prefixes) ? payload.unlocked_prefixes : existing.unlocked_prefixes;
    existing.equipped_prefix = payload.equipped_prefix ?? existing.equipped_prefix;
    existing.unlocked_auras = Array.isArray(payload.unlocked_auras) ? payload.unlocked_auras : existing.unlocked_auras;
    existing.equipped_aura = payload.equipped_aura ?? existing.equipped_aura;
    existing.unlocked_kill_messages = Array.isArray(payload.unlocked_kill_messages) ? payload.unlocked_kill_messages : existing.unlocked_kill_messages;
    existing.equipped_kill_message = payload.equipped_kill_message ?? existing.equipped_kill_message;
    if (typeof payload.is_alive === 'boolean') {
      existing.is_alive = payload.is_alive ? 1 : 0;
    } else if (payload.deaths !== undefined) {
      existing.is_alive = Number(existing.deaths) > 0 ? 0 : 1;
    }

    this.refreshDerivedStats();
    existing.last_login = new Date().toISOString();
    await this.persist();
    return existing;
  }

  async upsertAllPlayerStats(players = []) {
    if (!Array.isArray(players)) {
      return { updated: 0, failed: 0, errors: [] };
    }

    let updated = 0;
    const errors = [];

    for (const [index, player] of players.entries()) {
      try {
        await this.upsertFullPlayerStats(player);
        updated += 1;
      } catch (error) {
        errors.push({
          index,
          uuid: player?.uuid ?? null,
          reason: error?.message || 'Unknown error'
        });
      }
    }

    return {
      updated,
      failed: errors.length,
      errors
    };
  }

  async recordDeath(uuid) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (!existing) return;

    existing.is_alive = 0;
    existing.deaths += 1;
    this.state.server_stats.total_deaths += 1;
    await this.persist();
  }

  async recordLogin(uuid) {
    this.state.sessions.push({
      id: this.state.sessions.length + 1,
      player_uuid: uuid,
      login_time: new Date().toISOString(),
      logout_time: null
    });

    this.updateOnlineCount();
    await this.persist();
  }

  async recordLogout(uuid) {
    const session = [...this.state.sessions].reverse().find((s) => s.player_uuid === uuid && !s.logout_time);
    if (session) {
      session.logout_time = new Date().toISOString();
      const start = new Date(session.login_time).getTime();
      const end = new Date(session.logout_time).getTime();
      const minutes = Math.max(0, Math.round((end - start) / (1000 * 60)));

      const player = this.state.players.find((p) => p.uuid === uuid);
      if (player) {
        player.survival_time += minutes;
      }
    }

    this.updateOnlineCount();
    await this.persist();
  }

  async incrementDragonSlayer() {
    this.state.server_stats.dragon_slayers += 1;
    await this.persist();
  }

  async recordDragonSlay(uuid) {
    const player = this.state.players.find((p) => p.uuid === uuid);
    if (player) {
      player.kills += 1;
    }

    this.state.server_stats.dragon_slayers += 1;
    await this.persist();
  }

  async getServerStats() {
    await this.ensureLatestBlobState();

    return {
      total_players: this.state.players.length,
      total_deaths: this.state.server_stats.total_deaths,
      online_players: this.state.server_stats.online_players,
      dragon_slayers: this.state.server_stats.dragon_slayers,
      server_uptime: this.state.server_stats.server_uptime,
      updated_at: this.state.server_stats.updated_at
    };
  }

  async updateUptime(hours) {
    this.state.server_stats.server_uptime += Number(hours) || 0;
    await this.persist();
  }

  async searchPlayers(query) {
    await this.ensureLatestBlobState();

    const q = String(query).toLowerCase();
    const rows = this.state.players
      .filter((p) => String(p.username).toLowerCase().includes(q))
      .slice(0, 10);

    return rows;
  }
}

module.exports = new Database();
