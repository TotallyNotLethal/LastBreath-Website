const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'lastbreath.db');

class Database {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
        this.initializeTables();
      }
    });
  }

  initializeTables() {
    this.db.serialize(() => {
      // Players table
      this.db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        survival_time INTEGER DEFAULT 0,
        kills INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        is_alive BOOLEAN DEFAULT 1,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        avatar_url TEXT,
        join_date DATE
      )`);

      // Sessions table for tracking online time
      this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_uuid TEXT,
        login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        logout_time DATETIME,
        FOREIGN KEY(player_uuid) REFERENCES players(uuid)
      )`);

      // Server stats table
      this.db.run(`CREATE TABLE IF NOT EXISTS server_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_deaths INTEGER DEFAULT 0,
        total_players INTEGER DEFAULT 0,
        online_players INTEGER DEFAULT 0,
        dragon_slayers INTEGER DEFAULT 0,
        server_uptime REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Insert default stats row if not exists
      this.db.get("SELECT * FROM server_stats WHERE id = 1", (err, row) => {
        if (!row) {
          this.db.run("INSERT INTO server_stats (id) VALUES (1)");
        }
      });
    });
  }

  // Player methods
  getTopPlayers(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT username, survival_time, kills, deaths, is_alive, join_date, 
                CASE 
                  WHEN is_alive = 1 THEN 'Alive' 
                  ELSE 'Dead' 
                END as status
         FROM players 
         ORDER BY survival_time DESC, kills DESC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  getPlayerByUUID(uuid) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT * FROM players WHERE uuid = ?",
        [uuid],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  createPlayer(uuid, username) {
    return new Promise((resolve, reject) => {
      const joinDate = new Date().toISOString().split('T')[0];
      this.db.run(
        `INSERT OR IGNORE INTO players (uuid, username, survival_time, join_date) 
         VALUES (?, ?, 0, ?)`,
        [uuid, username, joinDate],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  updatePlayerStats(uuid, survivalTime, kills) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE players SET survival_time = ?, kills = ?, last_login = datetime('now') WHERE uuid = ?",
        [survivalTime, kills, uuid],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  recordDeath(uuid) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE players SET is_alive = 0, deaths = deaths + 1 WHERE uuid = ?",
        [uuid],
        (err) => {
          if (err) reject(err);
          else {
            // Increment total deaths
            this.db.run("UPDATE server_stats SET total_deaths = total_deaths + 1 WHERE id = 1");
            resolve();
          }
        }
      );
    });
  }

  recordLogin(uuid) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT INTO sessions (player_uuid) VALUES (?)",
        [uuid],
        (err) => {
          if (err) reject(err);
          else {
            // Update online count
            this.db.run("UPDATE server_stats SET online_players = (SELECT COUNT(*) FROM sessions WHERE logout_time IS NULL) WHERE id = 1");
            resolve();
          }
        }
      );
    });
  }

  recordLogout(uuid) {
    return new Promise((resolve, reject) => {
      // Update session
      this.db.run(
        `UPDATE sessions 
         SET logout_time = datetime('now') 
         WHERE player_uuid = ? AND logout_time IS NULL 
         ORDER BY login_time DESC LIMIT 1`,
        [uuid],
        (err) => {
          if (err) reject(err);
          else {
            // Calculate session duration and add to survival time
            this.db.get(
              `SELECT julianday(logout_time) - julianday(login_time) as duration_minutes 
               FROM sessions 
               WHERE player_uuid = ? 
               ORDER BY login_time DESC LIMIT 1`,
              [uuid],
              (err, row) => {
                if (row && row.duration_minutes) {
                  const minutes = Math.round(row.duration_minutes * 24 * 60);
                  this.db.run(
                    "UPDATE players SET survival_time = survival_time + ? WHERE uuid = ?",
                    [minutes, uuid]
                  );
                }
                // Update online count
                this.db.run("UPDATE server_stats SET online_players = (SELECT COUNT(*) FROM sessions WHERE logout_time IS NULL) WHERE id = 1");
                resolve();
              }
            );
          }
        }
      );
    });
  }

  incrementDragonSlayer() {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE server_stats SET dragon_slayers = dragon_slayers + 1 WHERE id = 1",
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  recordDragonSlay(uuid) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE players SET kills = kills + 1 WHERE uuid = ?",
        [uuid],
        (err) => {
          if (err) reject(err);
          else {
            this.incrementDragonSlayer().then(resolve).catch(reject);
          }
        }
      );
    });
  }

  // Stats methods
  getServerStats() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 
          (SELECT COUNT(*) FROM players) as total_players,
          total_deaths,
          online_players,
          dragon_slayers,
          server_uptime,
          updated_at
         FROM server_stats WHERE id = 1`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  updateUptime(hours) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE server_stats SET server_uptime = server_uptime + ?, updated_at = datetime('now') WHERE id = 1",
        [hours],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Search players
  searchPlayers(query) {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT * FROM players WHERE username LIKE ? LIMIT 10",
        [`%${query}%`],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }
}

module.exports = new Database();