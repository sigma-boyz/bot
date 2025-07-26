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

  try {
    status(server.ip, server.port, { timeout: 5000, enableSRV: true })
      .then(res => {
        try {
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
        } catch (err) {
          console.error(`[Sigma] Inner status handling error: ${err.message}`);
        }
      })
      .catch(err => console.error(`[Sigma] Status Error: ${err.message}`));
  } catch (err) {
    console.error(`[Sigma] checkPlayers() Error: ${err.message}`);
  }
}

// === CREATE BOT ===
function createBot(username) {
  try {
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
      try {
        console.log(`[Sigma] Bot spawned as ${username}`);

        try {
          mcData = mcData || require('minecraft-data')(bot.version);
        } catch (err) {
          console.error(`[${username}] Error loading minecraft-data: ${err.message}`);
          return;
        }

        if (!bot.registry) {
          console.warn(`[${username}] bot.registry is not available.`);
          return;
        }

        // === MOVEMENT ===
        if (config["movement-area"].enabled) {
          let movements;
          try {
            movements = new Movements(bot, mcData);
            bot.pathfinder.setMovements(movements);
          } catch (err) {
            console.error(`[${username}] Movement setup failed: ${err.message}`);
            return;
          }

          const { x: cx, z: cz } = config["movement-area"].center;
          const range = config["movement-area"].range;

          const move = () => {
            try {
              if (!bot || !bot.entity) return;

              const x = cx + ((Math.random() * range * 2 - range) | 0);
              const z = cz + ((Math.random() * range * 2 - range) | 0);

              for (let y = 255; y > 0; y--) {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (block && block.boundingBox !== 'empty') {
                  bot.pathfinder.setGoal(new GoalBlock(x, y + 1, z));
                  break;
                }
              }
            } catch (err) {
              console.error(`[${username}] Move Error: ${err.message}`);
            }
          };

          setInterval(move, 10000);
        } else if (config.utils["anti-afk"].enabled) {
          try {
            bot.setControlState('forward', true);
          } catch (err) {
            console.error(`[${username}] Anti-AFK Error: ${err.message}`);
          }
        }

        if (config.utils["chat-log"]) {
          bot.on('chat', (user, msg) => {
            try {
              if (user !== bot.username) {
                console.log(`[${bot.username}] ${user}: ${msg}`);
              }
            } catch (err) {
              console.error(`[${username}] Chat Log Error: ${err.message}`);
            }
          });
        }

      } catch (err) {
        console.error(`[${username}] spawn handler failed: ${err.message}`);
      }
    });

    bot.on('chat', (user, msg) => {
      try {
        if (msg === 'quit') {
          bot.quit();
          bot = null;
        }
      } catch (err) {
        console.error(`[${username}] Chat Command Error: ${err.message}`);
      }
    });

    bot.on('end', () => {
      try {
        bot = null;
        if (!realPlayerDetected && config.utils["auto-reconnect"]) {
          const delay = config.utils["auto-reconnect-delay"] || 60000;
          console.log(`[${username}] Reconnecting in ${delay / 1000}s`);
          setTimeout(() => createBot(username), delay);
        }
      } catch (err) {
        console.error(`[${username}] End Event Error: ${err.message}`);
      }
    });

    bot.on('error', err => {
      console.error(`[${username}] Error: ${err.message}`);
    });

    bot.on('kicked', reason => {
      try {
        console.log(`[${username}] Kicked: ${reason}`);
      } catch (err) {
        console.error(`[${username}] Kick Log Error: ${err.message}`);
      }
    });

    // Disable digging/placing
    bot.dig = async () => Promise.reject(new Error('Digging disabled'));
    bot.placeBlock = async () => Promise.reject(new Error('Placing disabled'));

  } catch (err) {
    console.error(`[Sigma] createBot() Error: ${err.message}`);
    bot = null;
    joining = false;
  }
}

// === START MONITORING ===
setInterval(checkPlayers, 5000);
checkPlayers();
