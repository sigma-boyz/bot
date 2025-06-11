const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const express = require('express');
const { Vec3 } = require('vec3');
const config = require('./settings.json');
const app = express();

const host = config.server.ip;
const port = config.server.port;

let bots = [null, null];
let botJoining = [false, false];
let reconnecting = [false, false];
let quitting = [false, false];
let botleft = [0, 0];
let realPlayerDetected = false;

app.get('/', (req, res) => res.send('Bots are running'));
app.listen(8000, () => console.log('Web server started on port 8000'));

function checkPlayers() {
  if (botJoining.includes(true)) return;

  try {
    status(host, port, { timeout: 5000, enableSRV: true })
      .then(response => {
        const online = response.players.online;
        console.log(`[${new Date().toLocaleTimeString()}] Players Online: ${online}`);

        if (online > 2) realPlayerDetected = true;

        if (bots.some(b => b) && realPlayerDetected && online === 3) {
          console.log('[INFO] Real player joined. Quitting bots...');
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
          setTimeout(() => createBot(0), 5000);
          setTimeout(() => createBot(1), 10000);
        }

        if (bots.some(b => b)) console.log('[INFO] Bots are active.');
      })
      .catch(err => console.error('Status check error:', err.message));
  } catch (err) {
    console.error('Player check crash:', err.message);
  }
}

function createBot(index) {
  try {
    const botConfig = config['bot-accounts'][index];

    const bot = mineflayer.createBot({
      username: botConfig.username,
      password: botConfig.password,
      auth: botConfig.type,
      host,
      port,
      version: config.server.version,
    });

    bots[index] = bot;
    botJoining[index] = false;
    reconnecting[index] = false;
    quitting[index] = false;

    bot.loadPlugin(pathfinder);
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    let pendingPromise = Promise.resolve();

    async function sendRegister(password) {
      return new Promise((resolve, reject) => {
        bot.chat(`/register ${password} ${password}`);
        console.log(`[Bot${index}] Sent /register`);
        bot.once('chat', (username, message) => {
          if (message.includes('successfully registered') || message.includes('already registered')) return resolve();
          reject(`Registration failed: "${message}"`);
        });
      });
    }

    async function sendLogin(password) {
      return new Promise((resolve, reject) => {
        bot.chat(`/login ${password}`);
        console.log(`[Bot${index}] Sent /login`);
        bot.once('chat', (username, message) => {
          if (message.includes('successfully logged in')) return resolve();
          reject(`Login failed: "${message}"`);
        });
      });
    }

    bot.once('spawn', () => {
      console.log(`\x1b[33m[Bot${index}] Joined the server\x1b[0m`);
      botleft[index] = 0;

      if (config.utils['auto-auth'].enabled) {
        const password = config.utils['auto-auth'].password;
        pendingPromise = pendingPromise
          .then(() => sendRegister(password))
          .then(() => sendLogin(password))
          .catch(console.error);
      }

      if (config.utils['chat-messages'].enabled) {
        const messages = config.utils['chat-messages'].messages;
        if (config.utils['chat-messages'].repeat) {
          const delay = config.utils['chat-messages']['repeat-delay'];
          let i = 0;
          setInterval(() => {
            bot.chat(messages[i]);
            i = (i + 1) % messages.length;
          }, delay * 1000);
        } else {
          messages.forEach(msg => bot.chat(msg));
        }
      }

      if (config.position.enabled) {
        const offset = index * 2; // to separate bot positions
        const pos = config.position;
        bot.pathfinder.setGoal(new GoalBlock(pos.x + offset, pos.y, pos.z + offset));
      }

      bot.setControlState('forward', true);
      bot.setControlState('jump', true);

      setInterval(() => {
        const yaw = Math.random() * 2 * Math.PI;
        const pitch = (Math.random() - 0.5) * Math.PI;
        bot.look(yaw, pitch, true);
      }, 5000);

      if (config.utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
      }

      if (config['movement-area'].enabled) {
        const center = config['movement-area'].center;
        const range = config['movement-area'].range;
        const interval = config['movement-area'].interval * 1000;

        function getRandomInt(min, max) {
          return Math.floor(Math.random() * (max - min + 1)) + min;
        }

        function getSafeY(x, z) {
          for (let y = 256; y > 0; y--) {
            const block = bot.blockAt(new Vec3(x, y, z));
            if (block && block.boundingBox !== 'empty') return y + 1;
          }
          return center.y;
        }

        function moveRandomly() {
          const x = getRandomInt(center.x - range, center.x + range);
          const z = getRandomInt(center.z - range, center.z + range);
          const y = getSafeY(x, z);
          bot.pathfinder.setGoal(new GoalBlock(x, y, z));
          setTimeout(moveRandomly, interval);
        }

        moveRandomly();
      }
    });

    bot.on('chat', (username, message) => {
      if (message === 'quit' && !reconnecting[index]) {
        reconnecting[index] = true;
        quitting[index] = true;
        console.log(`[Bot${index}] Quit command received.`);
        bot.quit();
      }
    });

    bot.on('goal_reached', () => {
      console.log(`[Bot${index}] Reached destination: ${bot.entity.position}`);
    });

    bot.on('death', () => {
      console.log(`[Bot${index}] Bot died. Respawned at: ${bot.entity.position}`);
    });

    bot.on('end', () => {
      botleft[index] = Date.now();
      if (!realPlayerDetected && !quitting[index]) {
        botJoining[index] = false;
        setTimeout(() => {
          console.log(`[Bot${index}] Attempting to reconnect...`);
          createBot(index);
        }, 20000);
      }
    });

    bot.on('kicked', reason => {
      console.log(`[Bot${index}] Kicked: ${reason}`);
    });

    bot.on('error', err => {
      console.error(`[Bot${index}] ERROR: ${err.message}`);
    });

    // Disable digging and placing
    bot.dig = async () => Promise.reject(new Error('Digging is disabled'));
    bot.placeBlock = async () => Promise.reject(new Error('Placing blocks is disabled'));

    // Stuck detection
    let lastPosition = null;
    let samePositionSince = null;

    setInterval(() => {
      if (!bot || !bot.entity || !bot.entity.position) return;
      const currentPos = bot.entity.position;
      if (!lastPosition) {
        lastPosition = currentPos.clone();
        samePositionSince = Date.now();
        return;
      }
      const dist = currentPos.distanceTo(lastPosition);
      if (dist < 0.1) {
        const stuckDuration = (Date.now() - samePositionSince) / 1000;
        if (stuckDuration >= 10) {
          console.log(`[Bot${index}] STUCK detected. Executing /kill.`);
          bot.chat('/kill');
          samePositionSince = Date.now();
        }
      } else {
        lastPosition = currentPos.clone();
        samePositionSince = Date.now();
      }
    }, 1000);
  } catch (err) {
    console.error(`[Bot Creation Error ${index}] ${err.message}`);
  }
}

setInterval(checkPlayers, 2000);
checkPlayers();
