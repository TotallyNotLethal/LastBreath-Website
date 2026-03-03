require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./database');
const { queryJavaServerStatus } = require('./minecraftQuery');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = 'LASTBREATH_PLUGIN_TEST_KEY_CHANGE_ME';
const LEADERBOARD_METRICS = [
  'playtime',
  'mobs_killed',
  'player_kills',
  'deaths',
  'revives',
  'blocks_mined',
  'blocks_placed',
  'rare_ores_mined',
  'crops_harvested',
  'fish_caught',
  'asteroids_looted'
];

// Security middleware
app.use(helmet());
app.use(cors({
  origin: '*', // Configure this for production: ['http://localhost', 'https://yourdomain.com']
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Stricter rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30
});

app.use(express.json());

// Middleware to check API key for write operations
const authenticateApiKey = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;

  if (xApiKey !== API_KEY && bearerToken !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// === PUBLIC ENDPOINTS (for frontend) ===

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const requestedMetric = String(req.query.metric || 'playtime').toLowerCase();
    const metric = LEADERBOARD_METRICS.includes(requestedMetric) ? requestedMetric : 'playtime';
    const players = await db.getTopPlayers(limit, metric);
    
    // Add rank to each player
    const rankedPlayers = players.map((player, index) => ({
      rank: index + 1,
      ...player,
      metric,
      // Convert survival time from minutes to days for display
      survival_days: Math.floor(player.survival_time / (24 * 60)),
      // Generate avatar URL if not set
      avatar: player.avatar_url || `https://mc-heads.net/avatar/${player.username}/100`
    }));

    res.json({
      success: true,
      data: rankedPlayers,
      available_metrics: LEADERBOARD_METRICS,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Get server stats
app.get('/api/stats', async (req, res) => {
  try {
    const [stats, minecraft] = await Promise.all([
      db.getServerStats(),
      queryJavaServerStatus('mc.lastbreath.net', 25565)
    ]);

    res.json({
      success: true,
      data: {
        total_players: stats.total_players || 0,
        total_deaths: stats.total_deaths || 0,
        online_players: minecraft.online ? minecraft.online_players : (stats.online_players || 0),
        dragon_slayers: stats.dragon_slayers || 0,
        server_uptime: stats.server_uptime || 0,
        last_updated: stats.updated_at,
        server_status: minecraft.online ? 'online' : 'offline',
        players_online: minecraft.players_online || [],
        minecraft_query: minecraft
      },
      source: {
        online_players: minecraft.online ? 'minecraft_java_query' : 'session_tracking_fallback'
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Alias for clients that use /state or /states naming
app.get(['/api/state', '/api/states'], async (req, res) => {
  try {
    const [stats, minecraft] = await Promise.all([
      db.getServerStats(),
      queryJavaServerStatus('mc.lastbreath.net', 25565)
    ]);

    res.json({
      success: true,
      data: {
        total_players: stats.total_players || 0,
        total_deaths: stats.total_deaths || 0,
        online_players: minecraft.online ? minecraft.online_players : (stats.online_players || 0),
        dragon_slayers: stats.dragon_slayers || 0,
        server_uptime: stats.server_uptime || 0,
        last_updated: stats.updated_at,
        server_status: minecraft.online ? 'online' : 'offline',
        players_online: minecraft.players_online || [],
        minecraft_query: minecraft
      },
      source: {
        online_players: minecraft.online ? 'minecraft_java_query' : 'session_tracking_fallback'
      }
    });
  } catch (error) {
    console.error('Error fetching state(s):', error);
    res.status(500).json({ error: 'Failed to fetch state(s)' });
  }
});

// Get player info
app.get('/api/player/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const player = await db.getPlayerByUsername(username) || await db.getPlayerByUUID(username);
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json({
      success: true,
      data: player
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player' });
  }
});

// Search players
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter required' });
    }
    
    const players = await db.searchPlayers(q);
    res.json({
      success: true,
      data: players
    });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// === PROTECTED ENDPOINTS (for Minecraft server plugin) ===

// Player joined
app.post('/api/player/join', authenticateApiKey, async (req, res) => {
  try {
    const { uuid, username } = req.body;
    
    if (!uuid || !username) {
      return res.status(400).json({ error: 'UUID and username required' });
    }

    // Create player if not exists and keep username updated
    await db.upsertPlayer(uuid, username);
    
    // Record login session
    await db.recordLogin(uuid);

    res.json({ 
      success: true, 
      message: 'Player login recorded',
      player: { uuid, username }
    });
  } catch (error) {
    console.error('Error recording player join:', error);
    res.status(500).json({ error: 'Failed to record join' });
  }
});

// Unified plugin endpoint to make Minecraft integration easier.
// event can be: join, leave, death, dragon, stats
const handlePluginEvent = async (req, res) => {
  try {
    const {
      event,
      uuid,
      username,
      survival_time,
      kills,
      death_message,
      players,
      ...fullStats
    } = req.body;

    if (!event) {
      return res.status(400).json({ error: 'event is required' });
    }

    if (event === 'join') {
      if (!uuid || !username) return res.status(400).json({ error: 'uuid and username required for join' });
      await db.upsertPlayer(uuid, username);
      await db.recordLogin(uuid);
    } else if (event === 'leave') {
      if (!uuid) return res.status(400).json({ error: 'uuid required for leave' });
      await db.recordLogout(uuid);
    } else if (event === 'death') {
      if (!uuid) return res.status(400).json({ error: 'uuid required for death' });
      await db.recordDeath(uuid);
      if (death_message) console.log(`[DEATH] ${death_message}`);
    } else if (event === 'dragon') {
      if (uuid) await db.recordDragonSlay(uuid);
      else await db.incrementDragonSlayer();
    } else if (event === 'stats') {
      if (!uuid) return res.status(400).json({ error: 'uuid required for stats' });
      await db.upsertFullPlayerStats({
        uuid,
        username,
        time_alive: fullStats.time_alive ?? fullStats.time_alive_ticks,
        kills,
        survival_time,
        ...fullStats
      });
    } else if (event === 'bulk_stats') {
      if (!Array.isArray(players)) return res.status(400).json({ error: 'players[] required for bulk_stats' });
      const updated = await db.upsertAllPlayerStats(players);
      return res.json({ success: true, message: 'bulk_stats event processed', updated });
    } else {
      return res.status(400).json({
        error: 'Invalid event value',
        allowed: ['join', 'leave', 'death', 'dragon', 'stats', 'bulk_stats']
      });
    }

    return res.json({ success: true, message: `${event} event processed` });
  } catch (error) {
    console.error('Error processing /api/plugin/event:', error);
    return res.status(500).json({ error: 'Failed to process plugin event' });
  }
};

// Accept both with and without trailing slash to avoid redirects from strict proxies/CDNs.
app.post(['/api/plugin/event', '/api/plugin/event/'], apiLimiter, authenticateApiKey, handlePluginEvent);

// Player left
app.post('/api/player/leave', authenticateApiKey, async (req, res) => {
  try {
    const { uuid } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    await db.recordLogout(uuid);

    res.json({ 
      success: true, 
      message: 'Player logout recorded' 
    });
  } catch (error) {
    console.error('Error recording player leave:', error);
    res.status(500).json({ error: 'Failed to record leave' });
  }
});

// Player died
app.post('/api/player/death', authenticateApiKey, async (req, res) => {
  try {
    const { uuid, death_message } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    await db.recordDeath(uuid);

    // Log death message if provided (could save to a deaths log table in future)
    if (death_message) {
      console.log(`[DEATH] ${death_message}`);
    }

    res.json({ 
      success: true, 
      message: 'Player death recorded',
      permanent: true // Hardcore - no respawn!
    });
  } catch (error) {
    console.error('Error recording death:', error);
    res.status(500).json({ error: 'Failed to record death' });
  }
});

// Dragon slain
app.post('/api/server/dragon', authenticateApiKey, async (req, res) => {
  try {
    const { uuid } = req.body;
    
    if (uuid) {
      await db.recordDragonSlay(uuid);
    } else {
      await db.incrementDragonSlayer();
    }

    res.json({ 
      success: true, 
      message: 'Dragon slay recorded' 
    });
  } catch (error) {
    console.error('Error recording dragon kill:', error);
    res.status(500).json({ error: 'Failed to record dragon kill' });
  }
});

// Update player stats (for periodic updates while playing)
app.post('/api/player/stats', authenticateApiKey, async (req, res) => {
  try {
    const { uuid, username, survival_time, kills, ...fullStats } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    await db.upsertFullPlayerStats({
      uuid,
      username,
      kills,
      survival_time,
      time_alive: fullStats.time_alive ?? fullStats.time_alive_ticks,
      ...fullStats
    });

    res.json({ 
      success: true, 
      message: 'Stats updated' 
    });
  } catch (error) {
    console.error('Error updating stats:', error);
    res.status(500).json({ error: 'Failed to update stats' });
  }
});

app.post('/api/players/bulk', authenticateApiKey, async (req, res) => {
  try {
    const { players } = req.body;
    if (!Array.isArray(players)) {
      return res.status(400).json({ error: 'players[] is required' });
    }

    const updated = await db.upsertAllPlayerStats(players);
    return res.json({ success: true, updated });
  } catch (error) {
    console.error('Error bulk syncing players:', error);
    return res.status(500).json({ error: 'Failed to bulk sync players' });
  }
});


// API index route
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Last Breath API is online',
    endpoints: {
      public: ['/api/leaderboard', '/api/stats', '/api/state', '/api/states', '/api/minecraft/status', '/api/player/:username', '/api/search', '/api/health'],
      plugin: ['/api/plugin/event', '/api/player/join', '/api/player/leave', '/api/player/death', '/api/player/stats', '/api/players/bulk', '/api/server/dragon']
    },
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    server: 'Last Breath API'
  });
});

app.get('/api/minecraft/status', async (req, res) => {
  try {
    const host = String(req.query.host || 'mc.lastbreath.net');
    const port = Number(req.query.port || 25565);
    const minecraft = await queryJavaServerStatus(host, port);

    return res.json({
      success: minecraft.online,
      data: minecraft
    });
  } catch (error) {
    console.error('Error fetching Minecraft status:', error);
    return res.status(500).json({ error: 'Failed to fetch Minecraft status' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});
module.exports = { app, PORT, API_KEY };
