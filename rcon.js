const dgram = require('dgram');

/**
 * RCON Client for Jedi Academy with MBII mod
 * Uses Quake 3 UDP RCON protocol with \rcon prefix
 */
class RconClient {
  constructor(host, port, password, timeout = 5000) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeout = timeout;
    this.socket = null;
    this.authenticated = false;
  }

  /**
   * Connect/create UDP socket
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        resolve();
        return;
      }

      this.socket = dgram.createSocket('udp4');
      
      this.socket.on('error', (err) => {
        console.error('[RCON] Socket error:', err.message);
        this.authenticated = false;
        reject(err);
      });

      this.socket.on('close', () => {
        this.authenticated = false;
      });

      // Bind to get port for responses
      this.socket.bind(() => {
        this.socket.setBroadcast(true);
        
        // Try to authenticate immediately
        this.authenticate().then(() => {
          resolve();
        }).catch((err) => {
          resolve();
        });
      });
    });
  }

  /**
   * Authenticate with RCON server
   */
  async authenticate() {
    return new Promise((resolve, reject) => {
      // Use same format as _sendCommand
      const prefix = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);
      const fullCommand = `rcon "${this.password}" echo auth`;
      const message = Buffer.from(fullCommand);
      const packet = Buffer.concat([prefix, message]);
      
      let timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, this.timeout);

      this.socket.once('message', (msg, rinfo) => {
        clearTimeout(timeout);
        const response = msg.toString();
        if (response.includes('auth') || response.length > 0) {
          this.authenticated = true;
          console.log('[RCON] Authenticated successfully');
          resolve();
        } else {
          reject(new Error('Authentication failed'));
        }
      });

      this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  /**
   * Send raw RCON command (MBII format)
   * @param {string} command - The RCON command to send
   * @param {boolean} getResponse - Whether to wait for response
   * @returns {Promise<string|null>} - Response from server if getResponse is true
   */
  send(command, getResponse = false) {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        this.connect().then(() => {
          this._sendCommand(command, getResponse).then(resolve).catch(reject);
        }).catch(reject);
        return;
      }

      this._sendCommand(command, getResponse).then(resolve).catch(reject);
    });
  }

  async _sendCommand(command, getResponse) {
    return new Promise((resolve, reject) => {
      // Match working Python format: 0xFF 0xFF 0xFF 0xFF prefix + rcon "password" command
      const prefix = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);
      const fullCommand = `rcon "${this.password}" ${command}`;
      const message = Buffer.from(fullCommand);
      const packet = Buffer.concat([prefix, message]);

      if (!getResponse) {
        this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
          if (err) reject(err);
          else resolve(null);
        });
        return;
      }

      // Wait for response
      let responseBuffer = '';
      let timeout = setTimeout(() => {
        reject(new Error('Command timeout'));
      }, this.timeout);

      const messageHandler = (msg, rinfo) => {
        // MBII/Quake 3 response format: strip the \rcon prefix and print\n
        let response = msg.toString();
        
        // Strip common prefixes
        response = response.replace(/\r/g, '');
        
        // Check if this is a response to our command
        if (response.length > 0) {
          responseBuffer += response;
          
          // For 'status' command, wait for more data if response is small
          // Servers send multiple packets for large responses
          if (command.includes('status') && msg.length < 500) {
            // Continue collecting
            setTimeout(() => {
              clearTimeout(timeout);
              this.socket.removeListener('message', messageHandler);
              // Clean up the response
              const cleanResponse = this.cleanResponse(responseBuffer);
              resolve(cleanResponse);
            }, 100);
          } else {
            clearTimeout(timeout);
            this.socket.removeListener('message', messageHandler);
            const cleanResponse = this.cleanResponse(responseBuffer);
            resolve(cleanResponse);
          }
        }
      };

      // Use once instead of on to prevent listener leak
      this.socket.once('message', messageHandler);
      
      this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.socket.removeListener('message', messageHandler);
          reject(err);
        }
      });
    });
  }

  /**
   * Clean up RCON response
   */
  cleanResponse(response) {
    if (!response) return '';
    
    // Remove rcon echo responses
    response = response.replace(/rcon \".*?\" /g, '');
    
    // Remove echo command echo
    response = response.replace(/echo /g, '');
    
    // Trim whitespace
    response = response.trim();
    
    return response;
  }

  /**
   * Send server-wide message (use color codes like ^1, ^2, etc.)
   */
  say(message) {
    // Use MBII color codes: ^1=red, ^2=green, ^3=yellow, ^5=cyan, ^7=white
    // Jedi Academy uses svsay for server-wide messages via RCON
    return this.send(`svsay \"${message}\"`);
  }

  /**
   * Send private message to player by slot ID
   */
  tell(playerId, message) {
    return this.send(`svtell ${playerId} \"${message}\"`);
  }

  /**
   * Get server status (list of players)
   */
  status() {
    return this.send('status', true);
  }

  /**
   * Get detailed player list
   */
  players() {
    return this.send('players', true);
  }

  /**
   * Disconnect from RCON server
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.authenticated = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.socket !== null;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected(),
      authenticated: this.authenticated,
      host: this.host,
      port: this.port
    };
  }
}

module.exports = RconClient;