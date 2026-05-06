# Jedi Academy MBII - Chat Bridge Bot

A two-way chat bridge between Discord and Star Wars Jedi Academy servers running the Movie Battles II (MBII) mod. Supports **single server** or **multiple servers** with dedicated Discord channels.

## Features

- **Game → Discord**: In-game chat automatically appears in Discord with color-coded embeds
- **Discord → Game**: Messages in Discord channels are sent to the game server via RCON
- **Multi-server**: Bridge multiple game servers, each with its own Discord channel
- **Per-server customization**: Different prefixes, colors, and log files per server

## Architecture

```
┌───────────────┐         ┌───────────────┐
│  JK:A Server 1│         │  JK:A Server 2│
│  games_mp.log │         │  games_mp.log │
└───────┬───────┘         └───────┬───────┘
        │  RCON                   │  RCON
        │  Log Watch              │  Log Watch
        │                          │
        └──────────┬──────────────┘
                   │
           ┌───────▼───────┐
           │  serverManager │
           │     .js       │
           └───────┬───────┘
                   │
           ┌───────▼───────┐
           │     bot.js    │
           │  (single bot) │
           └───────┬───────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼───────┐     ┌───────▼───────┐
│  #channel1    │     │  #channel2    │
│  (Discord)    │     │  (Discord)    │
└───────────────┘     └───────────────┘
```

**How it works:**

1. **Log Watching**: Each server has a dedicated log file watcher. The bot reads new lines every 2 seconds and parses chat messages using the `say: PlayerName: message` pattern from `games_mp.log`.

2. **Game → Discord**: When a player chats in-game, the bot detects it from the log, strips color codes (^0-^9, ^A-^F), and sends an embed to the configured Discord channel with the player name and message.

3. **Discord → Game**: When a user sends a message in a bridged Discord channel, the bot looks up which server that channel belongs to, then sends the message via RCON using `svsay` command.

4. **Channel Routing**: The bot maintains a map of Discord channel IDs → server IDs. Messages are routed based on which channel they came from.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure the Bot

Create `config.json` based on your needs:

#### Option A: Single Server (Legacy)

For backwards compatibility with existing configs:

```json
{
  discord: {
    token: 'YOUR_DISCORD_BOT_TOKEN',
    chatChannelId: '123456789012345678'
  },
  rcon: {
    host: '127.0.0.1',
    port: 29070,
    password: 'YOUR_RCON_PASSWORD',
    timeout: 5000
  },      chatBridge: {
        logFile: 'games_mp.log',
        gameToDiscordPrefix: '[GAME] ',
        discordToGamePrefix: '[Discord] ',
        messageFormat: 'embed'  // 'embed' for rich embeds, 'plain' for simple text
      }
}
```

#### Option B: Multiple Servers (Recommended)

Each server gets its own Discord channel:

```json
{
  discord: {
    token: 'YOUR_DISCORD_BOT_TOKEN'
  },
  servers: [
    {
      id: 'main',
      discord: { chatChannelId: '123456789012345678' },
      rcon: {
        host: '127.0.0.1',
        port: 29070,
        password: 'YOUR_PASSWORD',
        timeout: 5000
      },
      chatBridge: {
        logFile: 'games_mp.log',
        gameToDiscordPrefix: '[Main] ',
        discordToGamePrefix: '[Discord] '
      },
      embedColor: 0x5A9FD4
    },
    {
      id: 'pvp',
      discord: { chatChannelId: '987654321098765432' },
      rcon: {
        host: '192.168.1.100',
        port: 29071,
        password: 'YOUR_PASSWORD_2',
        timeout: 5000
      },
      chatBridge: {
        logFile: 'server2/games_mp.log',
        gameToDiscordPrefix: '[PvP] ',
        discordToGamePrefix: '[PvP] ',
        messageFormat: 'embed'  // 'embed' or 'plain'
      },
      embedColor: 0xFF6B6B
    }
  ]
}
```

### 3. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application/bot
3. Enable these **Privileged Gateway Intents** in Bot settings:
   - **Message Content Intent** — required to read message content
   - **Server Members Intent** — required for display names
4. Copy the bot token to `config.json`
5. Generate invite link with permissions: `Send Messages`, `Embed Links`, `Read Message History`
   - OAuth2 scopes: `bot`
   - Bot Permissions Integer: `82944` (Send Messages + Embed Links + Read Message History)

6. **Guild Install** (optional — requires Discord Approval):
   - In Discord Developer Portal → Installation → "Install Link"
   - Select "Guild Install" and choose default channel
   - This allows users to add the bot directly from your Discord server link
   - Requires your app to be approved by Discord for public bots

### 4. Game Server Configuration

Each JK:A server needs:

```bash
# Enable RCON
set rconpassword YOUR_PASSWORD

# Enable log file (in server config or via RCON)
set sv_logfile 1
```

The bot watches `games_mp.log` (or your configured path). Paths can be:
- **Relative** to where you run `bot.js` (e.g., `games_mp.log`, `server2/games_mp.log`)
- **Absolute** paths (e.g., `/home/gameserver/game/games_mp.log`)

**Log file location** varies by hosting:
- Self-hosted: Usually in the game directory
- GameServers.com: `/home/gameserver/game/`
- CloneWarsHosting: Check your control panel

## Usage

### Starting the Bot

```bash
npm start
```

For development (auto-restart on changes):
```bash
npm run dev
```

### How Chat Works

**From Game to Discord:**
```
[Player] DarthVader: Hello everyone!
         ↓ (detected in log file)
[Discord] [Main] DarthVader: Hello everyone!
```

**From Discord to Game:**
```
[Discord User] CoolPlayer: Hey game!
               ↓ (sent via RCON)
[Game] [Discord] CoolPlayer: Hey game!
```

### Getting Channel IDs

1. **Enable Developer Mode** in Discord: User Settings → Advanced → Developer Mode (toggle ON)
2. Right-click on a channel
3. Click **Copy Channel ID**

The ID looks like a long number (e.g., `123456789012345678`). Paste it into your config.

## File Structure

```
├── bot.js              # Main bot entry point
├── serverManager.js    # Multi-server management (RCON + log watching)
├── rcon.js             # RCON client for JK:A
├── config.json         # Your configuration (create from example)
├── config.example-multi.json  # Multi-server example
└── package.json
```

## Requirements

- Node.js v16 or higher
- Discord bot with **Message Content Intent** and **Server Members Intent** enabled
- JK:A server(s) with RCON enabled (`set rconpassword <password>`)
- Game log file enabled (`set sv_logfile 1`)

## Troubleshooting

**Bot not responding to messages:**
- Verify bot has permissions: Send Messages, Embed Links, Read Message History
- Check Message Content Intent is enabled in Developer Portal

**Game chat not appearing in Discord:**
- Verify `sv_logfile 1` is set on your game server
- Check log file path in config matches actual log location
- Ensure log file is being written to (try `say` in-game, then check log)

**RCON connection failures:**
- Verify RCON password matches between config and server
- Check firewall allows UDP to RCON port (default 29070)
- Try connecting with a tool like `netcat` to verify port is open

**Wrong channel for messages:**
- Each Discord channel must be mapped to a server in config
- Unmapped channels are silently ignored

## Process Management (Recommended)

For production, use PM2 to keep the bot running as a daemon with auto-restart on crashes.

### Setup

```bash
# Install PM2 (already included in package.json dependencies)
npm install
```

### PM2 Commands

```bash
# Start the bot as a daemon
npm run pm2:start

# View real-time logs
npm run pm2:logs

# View process list
npm run pm2:list

# Stop the daemon
npm run pm2:stop

# Restart after updates
npm run pm2:restart

# Auto-start on system reboot (run once)
pm2 startup  # Windows: pm2-service-install
pm2 save
```

### Or use ecosystem.config.js directly

```bash
pm2 start ecosystem.config.js
pm2 logs
pm2 restart mbii-bot
```

### Features
- Single instance (no clustering)
- Auto-restart on crash (up to 10 restarts, then gives up)
- Graceful shutdown (waits 5s for clean exit)
- No file logs (console only)