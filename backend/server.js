require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'dev_key';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: '*', // Configure this for production: ['http://localhost', 'https://yourdomain.com']
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// === PUBLIC ENDPOINTS (for frontend) ===

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const players = await db.getTopPlayers(limit);
    
    // Add rank to each player
    const rankedPlayers = players.map((player, index) => ({
      rank: index + 1,
      ...player,
      // Convert survival time from minutes to days for display
      survival_days: Math.floor(player.survival_time / (24 * 60)),
      // Generate avatar URL if not set
      avatar: player.avatar_url || `https://mc-heads.net/avatar/${player.username}/100`
    }));

    res.json({
      success: true,
      data: rankedPlayers,
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
    const stats = await db.getServerStats();
    res.json({
      success: true,
      data: {
        total_players: stats.total_players || 0,
        total_deaths: stats.total_deaths || 0,
        online_players: stats.online_players || 0,
        dragon_slayers: stats.dragon_slayers || 0,
        server_uptime: stats.server_uptime || 0,
        last_updated: stats.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get player info
app.get('/api/player/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const player = await db.getPlayerByUUID(username); // Or search by username
    
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
    res.status(500).api({ error: 'Search failed' });
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

    // Create player if not exists
    await db.createPlayer(uuid, username);
    
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
    const { uuid, survival_time, kills } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    await db.updatePlayerStats(uuid, survival_time, kills);

    res.json({ 
      success: true, 
      message: 'Stats updated' 
    });
  } catch (error) {
    console.error('Error updating stats:', error);
    res.status(500).json({ error: 'Failed to update stats' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    server: 'Last Breath API'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Last Breath API Server running on port ${PORT}`);
  console.log(`📊 API Endpoints:`);
  console.log(`   GET  /api/leaderboard     - Get top players`);
  console.log(`   GET  /api/stats           - Get server statistics`);
  console.log(`   GET  /api/player/:name    - Get specific player`);
  console.log(`   POST /api/player/join     - Record player login (auth required)`);
  console.log(`   POST /api/player/leave    - Record player logout (auth required)`);
  console.log(`   POST /api/player/death    - Record player death (auth required)`);
});

module.exports = app;