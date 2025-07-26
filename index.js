const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const express = require('express');
const { Vec3 } = require('vec3');
const config = require('./settings.json');

const app = express();
app.get('/', (_, res) => res.send('Sigma Bot Running'));
app.listen(8000, () => console.log('Web server started on port 8000'));

// === SERVER CONFIGURATION ===
const server = { ip: 'Sigma_Sigma_Boyz.aternos.me', port: 37216 };
let bot = null;
let joining = false;
let realPlayerDetected = false;

// === CACHE MC DATA ===
let mcData = null;

// === PLAYER CHECK ===
function checkPlayers() {
  if (joining) return;

  status(server.ip, server.port, { timeout: 5000, enableSRV: true })
    .then(res => {
      const online = res.players.online;
      console.log(`[Sigma] Players Online: ${online}`);

      if (online > 1) realPlayerDetected = true;

      if (bot && realPlayerDetected && online <= 2) {
        console.log('[Sigma] Real player detected. Quitting bot.');
        bot.quit();
        bot = null;
        return;
      }

      if (!bot && online === 0) {
        console.log('[Sigma] No players online. Launching bot.');
        realPlayerDetected = false;
        joining = true;
        setTimeout(() => createBot('sigma_bot'), 5000);
      }
    })
    .catch(err => console.error(`[Sigma] Status Error: ${err.message}`));
}

// === CREATE BOT ===
function createBot(username) {
  bot = mineflayer.createBot({
    username,
    host: server.ip,
    port: server.port,
    version: config.server.version,
    auth: config["bot-account"].type || 'mojang',
    password: config["bot-account"].password || undefined
  });

  joining = false;

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[Sigma] Bot spawned as ${username}`);
    mcData = mcData || require('minecraft-data')(bot.version);

    if (config["movement-area"].enabled) {
      const movements = new Movements(bot, mcData);
      bot.pathfinder.setMovements(movements);

      const { x: cx, z: cz } = config["movement-area"].center;
      const range = config["movement-area"].range;

      const move = () => {
        if (!bot.entity) return;
        const x = cx + (Math.random() * range * 2 - range) | 0;
        const z = cz + (Math.random() * range * 2 - range) | 0;

        for (let y = 255; y > 0; y--) {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.boundingBox !== 'empty') {
            bot.pathfinder.setGoal(new GoalBlock(x, y + 1, z));
            break;
          }
        }
      };

      setInterval(move, 10000); // every 10s
    } else if (config.utils["anti-afk"].enabled) {
      bot.setControlState('forward', true);
    }

    if (config.utils["chat-log"]) {
      bot.on('chat', (user, msg) => {
        if (user !== bot.username) console.log(`[${bot.username}] ${user}: ${msg}`);
      });
    }
  });

  bot.on('chat', (user, msg) => {
    if (msg === 'quit') {
      bot.quit();
      bot = null;
    }
  });

  bot.on('end', () => {
    bot = null;
    if (!realPlayerDetected && config.utils["auto-reconnect"]) {
      const delay = config.utils["auto-reconnect-delay"] || 60000;
      console.log(`[${username}] Reconnecting in ${delay / 1000}s`);
      setTimeout(() => createBot(username), delay);
    }
  });

  bot.on('error', err => console.error(`[${username}] Error: ${err.message}`));
  bot.on('kicked', reason => console.log(`[${username}] Kicked: ${reason}`));

  // Disable unnecessary actions
  bot.dig = async () => Promise.reject(new Error('Digging disabled'));
  bot.placeBlock = async () => Promise.reject(new Error('Placing disabled'));
}

// === START MONITORING ===
setInterval(checkPlayers, 5000);
checkPlayers();
