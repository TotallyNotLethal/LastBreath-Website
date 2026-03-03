const { app, PORT, API_KEY } = require('./app');

app.listen(PORT, () => {
  console.log(`🚀 Last Breath API Server running on port ${PORT}`);
  console.log(`🔐 Test API key: ${API_KEY}`);
  console.log('📊 API Endpoints:');
  console.log('   GET  /api                 - API index');
  console.log('   GET  /api/leaderboard     - Get top players');
  console.log('   GET  /api/stats           - Get server statistics');
  console.log('   GET  /api/state(s)        - Stats alias for plugin compatibility');
  console.log('   GET  /api/player/:name    - Get specific player');
  console.log('   GET  /api/players         - Get all known players');
  console.log('   POST /api/plugin/event    - Unified plugin event endpoint (auth required)');
  console.log('   POST /api/player/join     - Record player login (auth required)');
  console.log('   POST /api/player/leave    - Record player logout (auth required)');
  console.log('   POST /api/player/death    - Record player death (auth required)');
});
