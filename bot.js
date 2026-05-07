const { Client, GatewayIntentBits } = require('discord.js');
const ServerManager = require('./serverManager');

const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const serverManager = new ServerManager();

// Map Discord channel IDs to server IDs for quick lookup
const channelToServerMap = new Map();

console.log('🎮 Starting Multi-Server Jedi Academy MBII Chat Bridge...\n');

client.once('clientReady', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const servers = config.servers || [config];
  console.log(`📡 Found ${servers.length} server(s) to bridge\n`);

  // Initialize all servers
  await serverManager.initialize(servers, client);

  // Build channel -> server mapping
  for (const server of serverManager.getAllServers()) {
    if (server.chatChannel) {
      channelToServerMap.set(server.chatChannel.id, server.id);
      server.chatChannel.send(`🎮 **Chat Bridge Active** — Server: ${server.id}`).catch(console.error);
    }
  }

  client.user.setActivity(`Jedi Academy (${servers.length} servers)`, { type: 'PLAYING' });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if this message came from a bridged channel
  const serverId = channelToServerMap.get(message.channel.id);
  if (!serverId) return;

  const gameMsg = message.content.trim();
  if (!gameMsg) return;

  // Use server nickname if available, otherwise fall back to username
  const displayName = message.member?.nickname || message.author.username;
  
  const success = await serverManager.sendToServer(serverId, displayName, gameMsg);
  if (!success) {
    message.channel.send('⚠️ Failed to send message to game server. Will retry...').catch(console.error);
  }
});

client.on('disconnect', () => {
  serverManager.shutdown();
});

client.on('error', (error) => {
  console.error('[BOT] Error:', error);
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Graceful shutdown...');
  serverManager.shutdown();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[SHUTDOWN] Graceful shutdown...');
  serverManager.shutdown();
  client.destroy();
  process.exit(0);
});

client.login(config.discord.token).catch((error) => {
  console.error('[BOT] Failed to login:', error.message);
  process.exit(1);
});