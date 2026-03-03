const fs = require('fs');
const path = require('path');

const isServerlessRuntime = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const runtimeDbPath = process.env.DB_PATH
  || (isServerlessRuntime ? '/tmp/lastbreath-data.json' : path.join(__dirname, 'lastbreath-data.json'));
const DB_PATH = path.resolve(runtimeDbPath);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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

    this.load();
    console.log(`Connected to JSON database at ${DB_PATH}`);
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
      this.state = {
        players: Array.isArray(parsed.players) ? parsed.players : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        server_stats: {
          total_deaths: parsed.server_stats?.total_deaths || 0,
          online_players: parsed.server_stats?.online_players || 0,
          dragon_slayers: parsed.server_stats?.dragon_slayers || 0,
          server_uptime: parsed.server_stats?.server_uptime || 0,
          updated_at: parsed.server_stats?.updated_at || new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error loading JSON database, starting fresh:', error);
      this.persist();
    }
  }

  persist() {
    this.state.server_stats.updated_at = new Date().toISOString();
    fs.writeFileSync(DB_PATH, JSON.stringify(this.state, null, 2));
  }

  updateOnlineCount() {
    this.state.server_stats.online_players = this.state.sessions.filter((s) => !s.logout_time).length;
  }

  getTopPlayers(limit = 10) {
    const rows = [...this.state.players]
      .sort((a, b) => (b.survival_time - a.survival_time) || (b.kills - a.kills))
      .slice(0, limit)
      .map((p) => ({
        username: p.username,
        survival_time: p.survival_time,
        kills: p.kills,
        deaths: p.deaths,
        is_alive: p.is_alive,
        join_date: p.join_date,
        avatar_url: p.avatar_url,
        status: p.is_alive ? 'Alive' : 'Dead'
      }));

    return Promise.resolve(rows);
  }

  getPlayerByUUID(uuid) {
    return Promise.resolve(this.state.players.find((p) => p.uuid === uuid));
  }

  getPlayerByUsername(username) {
    const lower = String(username).toLowerCase();
    return Promise.resolve(this.state.players.find((p) => String(p.username).toLowerCase() === lower));
  }

  createPlayer(uuid, username) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (existing) return Promise.resolve(existing.id);

    const player = {
      id: this.state.players.length + 1,
      uuid,
      username,
      survival_time: 0,
      kills: 0,
      deaths: 0,
      is_alive: 1,
      last_login: new Date().toISOString(),
      created_at: new Date().toISOString(),
      avatar_url: null,
      join_date: new Date().toISOString().split('T')[0]
    };

    this.state.players.push(player);
    this.persist();
    return Promise.resolve(player.id);
  }

  upsertPlayer(uuid, username) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (existing) {
      existing.username = username;
      existing.last_login = new Date().toISOString();
      this.persist();
      return Promise.resolve(existing.id);
    }
    return this.createPlayer(uuid, username);
  }

  updatePlayerStats(uuid, survivalTime = 0, kills = 0) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (!existing) return Promise.resolve();

    existing.survival_time = Number(survivalTime) || 0;
    existing.kills = Number(kills) || 0;
    existing.last_login = new Date().toISOString();
    this.persist();
    return Promise.resolve();
  }

  recordDeath(uuid) {
    const existing = this.state.players.find((p) => p.uuid === uuid);
    if (!existing) return Promise.resolve();

    existing.is_alive = 0;
    existing.deaths += 1;
    this.state.server_stats.total_deaths += 1;
    this.persist();
    return Promise.resolve();
  }

  recordLogin(uuid) {
    this.state.sessions.push({
      id: this.state.sessions.length + 1,
      player_uuid: uuid,
      login_time: new Date().toISOString(),
      logout_time: null
    });

    this.updateOnlineCount();
    this.persist();
    return Promise.resolve();
  }

  recordLogout(uuid) {
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
    this.persist();
    return Promise.resolve();
  }

  incrementDragonSlayer() {
    this.state.server_stats.dragon_slayers += 1;
    this.persist();
    return Promise.resolve();
  }

  recordDragonSlay(uuid) {
    const player = this.state.players.find((p) => p.uuid === uuid);
    if (player) {
      player.kills += 1;
    }

    this.state.server_stats.dragon_slayers += 1;
    this.persist();
    return Promise.resolve();
  }

  getServerStats() {
    return Promise.resolve({
      total_players: this.state.players.length,
      total_deaths: this.state.server_stats.total_deaths,
      online_players: this.state.server_stats.online_players,
      dragon_slayers: this.state.server_stats.dragon_slayers,
      server_uptime: this.state.server_stats.server_uptime,
      updated_at: this.state.server_stats.updated_at
    });
  }

  updateUptime(hours) {
    this.state.server_stats.server_uptime += Number(hours) || 0;
    this.persist();
    return Promise.resolve();
  }

  searchPlayers(query) {
    const q = String(query).toLowerCase();
    const rows = this.state.players
      .filter((p) => String(p.username).toLowerCase().includes(q))
      .slice(0, 10);

    return Promise.resolve(rows);
  }
}

module.exports = new Database();
