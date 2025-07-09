const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const { Vec3 } = require('vec3');
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (_, res) => res.send('Bots running'));
app.listen(8000, () => console.log('Web server started on port 8000'));

// === SERVER CONFIGURATION (Only IP/Port here) ===
const servers = [
  { ip: 'Sigma_Sigma_Boyz.aternos.me', port: 37216 },
  { ip: 'MColab.aternos.me', port: 38054 }
];

// === State Tracking ===
let bots = [[], []]; // bots[0] = server 1 bots, bots[1] = server 2 bots
let botJoining = [[false, false], [false, false]];
let reconnecting = [[false, false], [false, false]];
let quitting = [[false, false], [false, false]];
let realPlayerDetected = [false, false];

// === Player Checker ===
function checkPlayers(serverIndex) {
  const server = servers[serverIndex];
  if (botJoining[serverIndex].some(j => j)) return;

  status(server.ip, server.port, { timeout: 5000, enableSRV: true }).then(response => {
    const online = response.players.online;
    console.log(`[${new Date().toLocaleTimeString()}] [Server${serverIndex + 1}] Players Online: ${online}`);

    if (online > 2) realPlayerDetected[serverIndex] = true;

    if (bots[serverIndex].some(b => b) && realPlayerDetected[serverIndex] && online === 3) {
      console.log(`[Server${serverIndex + 1}] Real player joined. Quitting bots...`);
      bots[serverIndex].forEach((bot, i) => {
        if (bot) {
          bot.quit();
          bots[serverIndex][i] = null;
        }
      });
      return;
    }

    if (bots[serverIndex].every(b => b === null || b === undefined) && online === 0) {
      console.log(`[Server${serverIndex + 1}] No players online. Starting bots...`);
      realPlayerDetected[serverIndex] = false;
      botJoining[serverIndex] = [true, true];

      setTimeout(() => createBot(serverIndex, 0, "sigma-bot"), 5000);
      setTimeout(() => createBot(serverIndex, 1, "sigma-sigma-bot"), 15000);
    }
  }).catch(err => {
    console.error(`[Server${serverIndex + 1}] Status error:`, err.message);
  });
}

// === Bot Creation ===
function createBot(serverIndex, botIndex, username) {
  const server = servers[serverIndex];

  const bot = mineflayer.createBot({
    username,
    password: config["bot-account"].password || undefined,
    auth: config["bot-account"].type || 'mojang',
    host: server.ip,
    port: server.port,
    version: config.server.version
  });

  bots[serverIndex][botIndex] = bot;
  botJoining[serverIndex][botIndex] = false;
  reconnecting[serverIndex][botIndex] = false;
  quitting[serverIndex][botIndex] = false;

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[Server${serverIndex + 1}][Bot${botIndex + 1}] Joined as ${username}`);

    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    const center = config["movement-area"].center;
    const range = config["movement-area"].range;
    const moveInterval = config["movement-area"].interval * 1000;

    const getSafeY = (x, z) => {
      for (let y = 255; y > 0; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.boundingBox !== 'empty') return y + 1;
      }
      return null;
    };

    const moveRandom = () => {
      if (!bot.entity) return;
      const x = center.x + Math.floor((Math.random() - 0.5) * range * 2);
      const z = center.z + Math.floor((Math.random() - 0.5) * range * 2);
      const y = getSafeY(x, z);

      if (y === null) {
        console.warn(`[Bot${username}] No safe Y found at (${x}, ?, ${z})`);
        return setTimeout(moveRandom, moveInterval + Math.random() * 5000);
      }

      bot.pathfinder.setGoal(new GoalBlock(x, y, z));
      setTimeout(moveRandom, moveInterval + Math.random() * 5000);
    };

    if (config["movement-area"].enabled) setTimeout(() => moveRandom(), 5000);

    setInterval(() => {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI / 2;
      bot.look(yaw, pitch, true);
    }, 4000 + Math.random() * 3000);

    setInterval(() => {
      const slot = Math.floor(Math.random() * 9);
      bot.setQuickBarSlot(slot);
    }, 8000 + Math.random() * 4000);

    setInterval(() => {
      const actions = ['sneak', 'jump', 'sprint', 'none'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      bot.setControlState('sneak', action === 'sneak');
      bot.setControlState('jump', action === 'jump');
      bot.setControlState('sprint', action === 'sprint');
      setTimeout(() => bot.clearControlStates(), 1000 + Math.random() * 2000);
    }, 10000 + Math.random() * 10000);

    if (config.utils["anti-afk"].enabled) {
      bot.setControlState('forward', true);
    }

    if (config.utils["chat-messages"].enabled) {
      const messages = config.utils["chat-messages"].messages;
      const delay = config.utils["chat-messages"]["repeat-delay"] * 1000;
      let i = 0;
      setInterval(() => {
        const msg = messages[i];
        let current = '';
        const chars = msg.split('');
        const typeMsg = () => {
          if (chars.length === 0) {
            bot.chat(current);
            return;
          }
          current += chars.shift();
          setTimeout(typeMsg, 50 + Math.random() * 100);
        };
        typeMsg();
        i = (i + 1) % messages.length;
      }, delay);
    }

    if (config.utils["chat-log"]) {
      bot.on('chat', (username, message) => {
        if (username !== bot.username) {
          console.log(`[Chat][${username}] ${message}`);
        }
      });
    }

    // === Stuck Detection ===
    let lastPos = null;
    let stillSince = null;
    setInterval(() => {
      if (!bot.entity) return;

      const pos = bot.entity.position.clone();
      const isMoving = bot.pathfinder.isMoving();

      if (!lastPos) {
        lastPos = pos;
        stillSince = Date.now();
        return;
      }

      if (pos.distanceTo(lastPos) < 0.1) {
        if (isMoving && Date.now() - stillSince > 30000) {
          console.log(`[Bot${username}] Stuck. Executing /kill`);
          bot.chat('/kill');
          stillSince = Date.now();
        }
      } else {
        lastPos = pos;
        stillSince = Date.now();
      }
    }, 5000);
  });

  bot.on('chat', (username, message) => {
    if (message === 'quit' && !reconnecting[serverIndex][botIndex]) {
      reconnecting[serverIndex][botIndex] = true;
      quitting[serverIndex][botIndex] = true;
      bot.quit();
    }
  });

  bot.on('death', () => {
    console.log(`[Bot${username}] Died. Respawning...`);
  });

  bot.on('end', () => {
    bots[serverIndex][botIndex] = null;
    if (!realPlayerDetected[serverIndex] && !quitting[serverIndex][botIndex] && config.utils["auto-reconnect"]) {
      const delay = (config.utils["auto-reconnect-delay"] || 60000) + botIndex * 20000;
      console.log(`[Bot${username}] Reconnecting in ${delay / 1000}s...`);
      setTimeout(() => createBot(serverIndex, botIndex, username), delay);
    }
  });

  bot.on('kicked', reason => {
    console.log(`[Bot${username}] Kicked: ${reason}`);
  });

  bot.on('error', err => {
    console.error(`[Bot${username}] Error: ${err.message}`);
  });

  // Prevent digging/placing
  bot.dig = async () => Promise.reject(new Error('Digging disabled'));
  bot.placeBlock = async () => Promise.reject(new Error('Placing disabled'));
}

// === Start Monitoring Servers ===
servers.forEach((_, i) => {
  setInterval(() => checkPlayers(i), 2000);
  checkPlayers(i);
});
