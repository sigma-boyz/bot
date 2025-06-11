const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const express = require('express');
const { Vec3 } = require('vec3');
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

  try {
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
        setTimeout(() => createBot(0,"john"), 5000);
        setTimeout(() => createBot(1,"max"), 10000);
      }

      if (bots.some(b => b)) console.log('[INFO] Bots are active.');
    }).catch(err => {
      console.error('Status check error:', err.message);
    });
  } catch (err) {
    console.error('Player check failed:', err.message);
  }
}

function createBot(index,username) {
  try {
    const botUsername = username
    const bot = mineflayer.createBot({
      username: botUsername,
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

      // Chat messages
      if (config.utils["chat-messages"].enabled) {
        const messages = config.utils["chat-messages"].messages;
        if (config.utils["chat-messages"].repeat) {
          const delay = config.utils["chat-messages"]["repeat-delay"] * 1000;
          let i = 0;
          setInterval(() => {
            bot.chat(messages[i]);
            i = (i + 1) % messages.length;
          }, delay);
        } else {
          messages.forEach(msg => bot.chat(msg));
        }
      }

      // Anti-AFK sneak
      if (config.utils["anti-afk"].enabled && config.utils["anti-afk"].sneak) {
        bot.setControlState('sneak', true);
      }

      // Anti-AFK movement
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      setInterval(() => {
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * Math.PI;
        bot.look(yaw, pitch, true);
      }, 5000);

      // Movement within area
      if (config["movement-area"].enabled) {
        const area = config["movement-area"];
        const center = area.center;
        const range = area.range;
        const interval = area.interval * 1000;
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        bot.pathfinder.setMovements(defaultMove);

        const getSafeY = (x, z) => {
          for (let y = 256; y > 0; y--) {
            const block = bot.blockAt(new Vec3(x, y, z));
            if (block && block.boundingBox !== 'empty') return y + 1;
          }
          return center.y;
        };

        const moveRandom = () => {
          const x = center.x + Math.floor((Math.random() - 0.5) * range * 2);
          const z = center.z + Math.floor((Math.random() - 0.5) * range * 2);
          const y = getSafeY(x, z);
          bot.pathfinder.setGoal(new GoalBlock(x, y, z));
          setTimeout(moveRandom, interval);
        };

        moveRandom();
      }

      if (config.utils["chat-log"]) {
        bot.on('chat', (username, message) => {
          if (username !== bot.username) {
            console.log(`[Chat][${username}] ${message}`);
          }
        });
      }
    });

    // Handle manual quit
    bot.on('chat', (username, message) => {
      if (message === 'quit' && !reconnecting[index]) {
        reconnecting[index] = true;
        quitting[index] = true;
        console.log(`[Bot${index + 1}] Quit command received.`);
        bot.quit();
      }
    });

    bot.on('goal_reached', () => {
      console.log(`[Bot${index + 1}] Reached goal: ${bot.entity.position}`);
    });

    bot.on('death', () => {
      console.log(`[Bot${index + 1}] Died. Respawning...`);
    });

    bot.on('end', () => {
      botleft[index] = Date.now();
      if (!realPlayerDetected && !quitting[index] && config.utils["auto-reconnect"]) {
        setTimeout(() => {
          console.log(`[Bot${index + 1}] Attempting reconnect...`);
          createBot(index);
        }, config.utils["auto-reconnect-delay"] || 10000);
      }
    });

    bot.on('kicked', reason => {
      console.log(`[Bot${index + 1}] Kicked: ${reason}`);
    });

    bot.on('error', err => {
      console.error(`[Bot${index + 1}] Error: ${err.message}`);
    });

    // Disable digging and placing
    bot.dig = async () => Promise.reject(new Error('Digging is disabled'));
    bot.placeBlock = async () => Promise.reject(new Error('Placing is disabled'));

    // Stuck detection
    let lastPos = null;
    let stillSince = null;

    setInterval(() => {
      if (!bot.entity || !bot.entity.position) return;
      const pos = bot.entity.position;
      if (!lastPos) {
        lastPos = pos.clone();
        stillSince = Date.now();
        return;
      }

      const dist = pos.distanceTo(lastPos);
      if (dist < 0.1) {
        if (Date.now() - stillSince >= 10000) {
          console.log(`[Bot${index + 1}] Stuck. Using /kill`);
          bot.chat('/kill');
          stillSince = Date.now();
        }
      } else {
        lastPos = pos.clone();
        stillSince = Date.now();
      }
    }, 1000);
  } catch (err) {
    console.error(`[Bot Creation Error ${index}] ${err.message}`);
  }
}

setInterval(checkPlayers, 2000);
checkPlayers();
