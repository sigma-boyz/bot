const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const express = require('express');
const config = require('./settings.json');
const { Vec3 } = require('vec3');

const app = express();
app.get('/', (_, res) => res.send('Bots running'));
app.listen(8000, () => console.log('Web server started on port 8000'));

// === SERVER CONFIGURATION ===
const servers = [
  { ip: 'Sigma_Sigma_Boyz.aternos.me', port: 37216 },
  { ip: 'MColab.aternos.me', port: 38054 }
];

// === STATE ===
let bots = [[], []];
let botJoining = [[false, false], [false, false]];
let realPlayerDetected = [false, false];

// === SHARED DATA ===
const mcDataCache = {};
function getMcData(version) {
  if (!mcDataCache[version]) {
    mcDataCache[version] = require('minecraft-data')(version);
  }
  return mcDataCache[version];
}

// === PLAYER CHECK ===
function checkPlayers(serverIndex) {
  const server = servers[serverIndex];
  if (botJoining[serverIndex].some(Boolean)) return;

  status(server.ip, server.port, { timeout: 5000, enableSRV: true })
    .then(res => {
      const online = res.players.online;
      console.log(`[Server${serverIndex + 1}] Players: ${online}`);

      if (online > 2) realPlayerDetected[serverIndex] = true;

      if (bots[serverIndex].some(Boolean) && realPlayerDetected[serverIndex] && online === 3) {
        console.log(`[Server${serverIndex + 1}] Real player detected. Quitting bots.`);
        bots[serverIndex].forEach((bot, i) => {
          if (bot) {
            bot.quit();
            bots[serverIndex][i] = null;
          }
        });
        return;
      }

      if (bots[serverIndex].every(b => !b) && online === 0) {
        console.log(`[Server${serverIndex + 1}] No players. Launching bots.`);
        realPlayerDetected[serverIndex] = false;
        botJoining[serverIndex] = [true, true];

        setTimeout(() => createBot(serverIndex, 0, 'john'), 4000);
        setTimeout(() => createBot(serverIndex, 1, 'max'), 8000);
      }
    })
    .catch(err => console.error(`[Server${serverIndex + 1}] Error: ${err.message}`));
}

// === CREATE BOT ===
function createBot(serverIndex, botIndex, username) {
  const server = servers[serverIndex];
  const bot = mineflayer.createBot({
    username,
    host: server.ip,
    port: server.port,
    version: config.server.version,
    auth: config["bot-account"].type || 'mojang',
    password: config["bot-account"].password || undefined
  });

  bots[serverIndex][botIndex] = bot;

  botJoining[serverIndex][botIndex] = false;

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[Server${serverIndex + 1}][Bot${botIndex + 1}] Spawned as ${username}`);

    // === Simple Movement (less CPU/RAM) ===
    if (config["movement-area"].enabled) {
      const mcData = getMcData(bot.version);
      const movements = new Movements(bot, mcData);
      bot.pathfinder.setMovements(movements);

      const center = config["movement-area"].center;
      const range = config["movement-area"].range;

      const moveRandom = () => {
        if (!bot.entity) return;

        const x = center.x + (Math.random() * range * 2 - range) | 0;
        const z = center.z + (Math.random() * range * 2 - range) | 0;

        for (let y = 255; y > 0; y--) {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.boundingBox !== 'empty') {
            bot.pathfinder.setGoal(new GoalBlock(x, y + 1, z));
            break;
          }
        }
      };

      setInterval(() => moveRandom(), 10000); // move every 10s
    }

    // === Anti-AFK Only ===
    if (config.utils["anti-afk"].enabled) {
      bot.setControlState('forward', true);
    }

    // === Chat Logger (Optional) ===
    if (config.utils["chat-log"]) {
      bot.on('chat', (user, msg) => {
        if (user !== bot.username) console.log(`[${bot.username}] ${user}: ${msg}`);
      });
    }
  });

  // === EVENTS ===
  bot.on('chat', (user, msg) => {
    if (msg === 'quit') {
      bot.quit();
      bots[serverIndex][botIndex] = null;
    }
  });

  bot.on('end', () => {
    bots[serverIndex][botIndex] = null;
    if (!realPlayerDetected[serverIndex] && config.utils["auto-reconnect"]) {
      const delay = config.utils["auto-reconnect-delay"] || 60000;
      console.log(`[${username}] Reconnecting in ${delay / 1000}s`);
      setTimeout(() => createBot(serverIndex, botIndex, username), delay);
    }
  });

  bot.on('error', err => {
    console.error(`[${username}] Error: ${err.message}`);
  });

  bot.on('kicked', reason => {
    console.log(`[${username}] Kicked: ${reason}`);
  });

  // Disable block placing/digging to save memory
  bot.dig = async () => Promise.reject(new Error('Digging disabled'));
  bot.placeBlock = async () => Promise.reject(new Error('Placing disabled'));
}

// === START MONITORING ===
servers.forEach((_, i) => {
  setInterval(() => checkPlayers(i), 5000); // check every 5s
  checkPlayers(i);
});
