const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const { Vec3 } = require('vec3');
const express = require('express');
const config = require('./settings.json');

const app = express();
const host = config.server.ip;
const port = config.server.port;

app.get('/', (_, res) => res.send('Bots running'));
app.listen(8000, () => console.log('Web server started on port 8000'));

let bots = [null, null];
let botJoining = [false, false];
let reconnecting = [false, false];
let quitting = [false, false];
let botleft = [0, 0];
let realPlayerDetected = false;

function checkPlayers() {
  if (botJoining.includes(true)) return;

  status(host, port, { timeout: 5000, enableSRV: true }).then(response => {
    const online = response.players.online;
    console.log(`[${new Date().toLocaleTimeString()}] Players Online: ${online}`);

    if (online > 2) realPlayerDetected = true;

    if (bots.some(b => b) && realPlayerDetected && online === 3) {
      console.log('[INFO] Real player joined. Quitting all bots...');
      bots.forEach((bot, i) => {
        if (bot) {
          bot.quit();
          bots[i] = null;
        }
      });
      return;
    }

    if (bots.every(b => b === null) && online === 0) {
      console.log('[INFO] No players online. Starting bots...');
      botJoining = [true, true];
      realPlayerDetected = false;
      setTimeout(() => createBot(0, "john"), 5000);
      setTimeout(() => createBot(1, "max"), 15000);
    }
  }).catch(err => {
    console.error('Status check error:', err.message);
  });
}

function createBot(index, username) {
  try {
    const bot = mineflayer.createBot({
      username,
      password: config["bot-account"].password || undefined,
      auth: config["bot-account"].type || 'mojang',
      host,
      port,
      version: config.server.version
    });

    bots[index] = bot;
    botJoining[index] = false;
    reconnecting[index] = false;
    quitting[index] = false;

    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
      console.log(`\x1b[33m[Bot${index + 1}] Joined the server\x1b[0m`);
      botleft[index] = 0;

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
          console.warn(`[Bot${index + 1}] No safe Y found at (${x}, ?, ${z}) — skipping movement.`);
          setTimeout(moveRandom, moveInterval + Math.floor(Math.random() * 5000));
          return;
        }

        bot.pathfinder.setGoal(new GoalBlock(x, y, z));
        const nextMoveDelay = moveInterval + Math.floor(Math.random() * 5000);
        setTimeout(moveRandom, nextMoveDelay);
      };

      if (config["movement-area"].enabled) {
        setTimeout(() => moveRandom(), 5000);
      }

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
        setTimeout(() => {
          bot.clearControlStates();
        }, 1000 + Math.random() * 2000);
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
          const chars = msg.split('');
          let current = '';
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

      // === Improved Stuck Detection ===
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
            console.log(`[Bot${index + 1}] Stuck for too long. Executing /kill`);
            bot.chat('/kill');
            stillSince = Date.now();
          }
        } else {
          lastPos = pos;
          stillSince = Date.now();
        }
      }, 5000); // Check every 5 seconds

    });

    bot.on('chat', (username, message) => {
      if (message === 'quit' && !reconnecting[index]) {
        reconnecting[index] = true;
        quitting[index] = true;
        bot.quit();
      }
    });

    bot.on('death', () => {
      console.log(`[Bot${index + 1}] Died. Respawning...`);
    });

    bot.on('end', () => {
      botleft[index] = Date.now();
      if (!realPlayerDetected && !quitting[index] && config.utils["auto-reconnect"]) {
        const delay = (config.utils["auto-reconnect-delay"] || 60000) + index * 20000;
        console.log(`[Bot${index + 1}] Reconnecting in ${delay / 1000}s...`);
        setTimeout(() => createBot(index, index === 0 ? "john" : "max"), delay);
      }
    });

    bot.on('kicked', reason => {
      console.log(`[Bot${index + 1}] Kicked: ${reason}`);
    });

    bot.on('error', err => {
      console.error(`[Bot${index + 1}] Error: ${err.message}`);
    });

    // Prevent digging/placing
    bot.dig = async () => Promise.reject(new Error('Digging is disabled'));
    bot.placeBlock = async () => Promise.reject(new Error('Placing is disabled'));

  } catch (err) {
    console.error(`[Bot Creation Error ${index}] ${err.message}`);
  }
}

setInterval(checkPlayers, 2000);
checkPlayers();
