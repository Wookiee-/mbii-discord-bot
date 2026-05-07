const RconClient = require('./rcon');
const fs = require('fs');

/**
 * Manages multiple game server bridges
 * Each server has its own RCON connection and log watcher
 */
class ServerManager {
  constructor() {
    this.servers = new Map();
  }

  /**
   * Initialize all servers from config
   * @param {Array} serverConfigs - Array of server config objects
   * @param {Object} discordClient - Discord client for sending messages
   */
  async initialize(serverConfigs, discordClient) {
    if (!serverConfigs || !Array.isArray(serverConfigs) || serverConfigs.length === 0) {
      console.error('[ERROR] No servers configured! Check your config.json');
      return;
    }
    
    for (const config of serverConfigs) {
      // Backwards compatibility: assign default id if missing
      if (!config.id) {
        config.id = 'server';
      }
      await this.addServer(config, discordClient);
    }
  }

  /**
   * Add a server to the manager
   * @param {Object} config - Server configuration
   * @param {Object} discordClient - Discord client for sending messages
   */
  async addServer(config, discordClient) {
    const rcon = new RconClient(
      config.rcon.host,
      config.rcon.port,
      config.rcon.password,
      config.rcon.timeout || 5000
    );

    const chatChannel = discordClient.channels.cache.get(config.discord.chatChannelId);

    const serverState = {
      id: config.id,
      config: config,
      rcon: rcon,
      chatChannel: chatChannel,
      logWatcher: null,
      lastLogPosition: 0,
      readInterval: null,
      watcherPollInterval: null,
      retryPending: false
    };

    this.servers.set(config.id, serverState);

    // Connect RCON
    try {
      await rcon.connect();
      console.log(`[${config.id}] RCON Connected to ${config.rcon.host}:${config.rcon.port}`);
    } catch (error) {
      console.error(`[${config.id}] RCON connection failed: ${error.message}`);
    }

    // Start log watcher
    this.startLogWatcher(config.id);

    return serverState;
  }

  /**
   * Get a server by ID
   */
  getServer(id) {
    return this.servers.get(id);
  }

  /**
   * Get all servers
   */
  getAllServers() {
    return Array.from(this.servers.values());
  }

  /**
   * Start watching a server's log file
   */
  startLogWatcher(serverId) {
    const server = this.servers.get(serverId);
    if (!server) return;

    const logFile = server.config.chatBridge.logFile;

    const ensureLogWatcher = () => {
      if (server.logWatcher) {
        try { server.logWatcher.close(); } catch (e) {}
        server.logWatcher = null;
      }

      if (fs.existsSync(logFile)) {
        try {
          server.lastLogPosition = fs.statSync(logFile).size;
          console.log(`[${serverId}] Watching log: ${logFile} (${server.lastLogPosition} bytes)`);

          server.logWatcher = fs.watch(logFile, (eventType) => {
            if (eventType === 'change') {
              this.readNewChatLines(serverId);
            }
          });

          server.logWatcher.on('error', (err) => {
            server.logWatcher = null;
            if (!server.retryPending) {
              server.retryPending = true;
              setTimeout(() => {
                server.retryPending = false;
                ensureLogWatcher();
              }, 5000);
            }
          });

          return true;
        } catch (err) {
          // Silent fail
        }
      }
      return false;
    };

    if (!ensureLogWatcher()) {
      server.watcherPollInterval = setInterval(() => {
        if (!server.logWatcher && ensureLogWatcher()) {
          if (server.watcherPollInterval) {
            clearInterval(server.watcherPollInterval);
            server.watcherPollInterval = null;
          }
        }
      }, 5000);
    }

    server.readInterval = setInterval(() => this.readNewChatLines(serverId), 2000);
  }

  /**
   * Read new chat lines from a server's log file
   */
  readNewChatLines(serverId) {
    const server = this.servers.get(serverId);
    if (!server || !server.chatChannel) return;

    const logFile = server.config.chatBridge.logFile;
    if (!fs.existsSync(logFile)) return;

    try {
      const stats = fs.statSync(logFile);

      if (stats.size < server.lastLogPosition) {
        server.lastLogPosition = 0;
      }

      if (stats.size > server.lastLogPosition) {
        const buffer = Buffer.alloc(stats.size - server.lastLogPosition);
        const fd = fs.openSync(logFile, 'r');
        fs.readSync(fd, buffer, 0, buffer.length, server.lastLogPosition);
        fs.closeSync(fd);

        const newContent = buffer.toString('utf8');
        const lines = newContent.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chat = this.parseChatLine(trimmed);
          if (chat) {
            // Skip messages from Server (rcon svsay) and console
            const senderName = chat.playerName.toLowerCase();
            if (senderName === 'console' || senderName === 'server') continue;

            const cleanName = this.stripColors(this.normalizeName(chat.playerName));
            const cleanMsg = this.stripColors(chat.message);

            // Check if using plain text format or embed format
            const usePlainText = server.config.chatBridge.messageFormat === 'plain';

            if (usePlainText) {
              // Plain text format: PlayerName: message
              const plainMessage = `${cleanName}: ${cleanMsg}`;
              server.chatChannel.send(plainMessage).catch(err => {
                console.error(`[${serverId}] Failed to send to Discord:`, err.message);
              });
            } else {
              // Rich embed format (default)
              const embed = {
                color: server.config.embedColor || 0x5A9FD4,
                author: {
                  name: cleanName,
                  icon_url: server.config.embedIcon || 'https://i.imgur.com/JnLwO.png'
                },
                description: cleanMsg,
                timestamp: new Date().toISOString()
              };
              server.chatChannel.send({ embeds: [embed] }).catch(err => {
                console.error(`[${serverId}] Failed to send to Discord:`, err.message);
              });
            }
          }
        }

        server.lastLogPosition = stats.size;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[${serverId}] Log read error:`, error.message);
      }
    }
  }

  /**
   * Parse a chat line from the game log
   */
  parseChatLine(line) {
    const sayPattern = /say:\s*(.*?):\s+(.*)$/;
    const match = line.match(sayPattern);
    if (match) {
      return {
        type: 'say',
        playerName: match[1].trim(),
        message: match[2].trim()
      };
    }
    return null;
  }

  /**
   * Strip Quake 3 color codes
   */
  stripColors(text) {
    if (!text) return '';
    // Remove Quake 3/MBII color codes: ^0 through ^9, and ^A through ^F
    return text.replace(/\^[0-9A-Fa-f]/g, '');
  }

  /**
   * Normalize player name (remove trailing ^7)
   */
  normalizeName(name) {
    if (!name) return '';
    let clean = name.trim();
    while (clean.startsWith('^7')) clean = clean.slice(2).trim();
    while (clean.endsWith('^7')) clean = clean.slice(0, -2).trim();
    return clean || name.trim();
  }

  /**
   * Send a message from Discord to a specific server
   */
  async sendToServer(serverId, discordUser, message) {
    const server = this.servers.get(serverId);
    if (!server) {
      console.error(`[${serverId}] Server not found`);
      return false;
    }

    try {
      if (!server.rcon.isConnected()) {
        await server.rcon.connect();
      }

      const prefix = server.config.chatBridge.discordToGamePrefix || '^5[^7Discord^5]:^7 ';
      const capitalizeName = (name) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      const formattedMsg = `${prefix}${capitalizeName(discordUser)}: ${message}`.substring(0, 200);
      const rconCmd = `svsay \"${formattedMsg}\"`;

      await server.rcon.send(rconCmd);
      return true;
    } catch (error) {
      console.error(`[${serverId}] Failed to send to game: ${error.message}`);
      return false;
    }
  }

  /**
   * Shutdown all connections
   */
  shutdown() {
    console.log('[SERVERS] Shutting down all connections...');
    for (const [id, server] of this.servers) {
      if (server.logWatcher) {
        try { server.logWatcher.close(); } catch (e) {}
      }
      if (server.readInterval) clearInterval(server.readInterval);
      if (server.watcherPollInterval) clearInterval(server.watcherPollInterval);
      server.rcon.disconnect();
      console.log(`[${id}] Shutdown complete`);
    }
    this.servers.clear();
  }
}

module.exports = ServerManager;