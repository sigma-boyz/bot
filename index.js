const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const { status } = require('minecraft-server-util');
const express = require('express');
const { Vec3 } = require('vec3');

const config = require('./settings.json');
const app = express();

const host = 'Sigma-boyz.aternos.me';
const port = 37216;

let BOT = null;
let realPlayerDetected = false;
let botjoining = false;
let reconnecting = false;
let quitting = false;

app.get('/', (req, res) => res.send('Bot has arrived'));

app.listen(8000, () => console.log('Server started'));

function checkPlayers() {
  if (botjoining) return;

  try {
    status(host, port, { timeout: 5000, enableSRV: true })
      .then(response => {
        const online = response.players.online;
        console.log(`[${new Date().toLocaleTimeString()}] Players Online: ${online}`);

        if (online > 1) realPlayerDetected = true;

        if (BOT && realPlayerDetected && online === 2) {
          console.log('[INFO] Real player joined. Quitting bot...');
          BOT.quit();
          BOT = null;
          return;
        }

        if (!BOT && online === 0) {
          console.log('[INFO] No players. Starting bot...');
          botjoining = true;
          createBot();
          realPlayerDetected = false;
        }

        if (BOT) console.log('[INFO] Bot running.');
      })
      .catch(err => console.error('Status check error:', err.message));
  } catch (err) {
    console.error('Player check crash:', err.message);
  }
}

function createBot() {
  try {
    const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
    });

    bot.loadPlugin(pathfinder);
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    let pendingPromise = Promise.resolve();

    async function sendRegister(password) {
      return new Promise((resolve, reject) => {
        try {
          bot.chat(`/register ${password} ${password}`);
          console.log(`[Auth] Sent /register`);

          bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`);
            if (message.includes('successfully registered') || message.includes('already registered')) return resolve();
            reject(`Registration failed: "${message}"`);
          });
        } catch (err) {
          reject(`Registration crash: ${err.message}`);
        }
      });
    }

    async function sendLogin(password) {
      return new Promise((resolve, reject) => {
        try {
          bot.chat(`/login ${password}`);
          console.log(`[Auth] Sent /login`);

          bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`);
            if (message.includes('successfully logged in')) return resolve();
            reject(`Login failed: "${message}"`);
          });
        } catch (err) {
          reject(`Login crash: ${err.message}`);
        }
      });
    }

    bot.once('spawn', () => {
      try {
        console.log('\x1b[33m[AfkBot] Bot joined the server\x1b[0m');
        botjoining = false;
        reconnecting = false;
        quitting = false;
        BOT = bot;

        bot.pathfinder.setMovements(defaultMove);

        // Auto-auth
        if (config.utils['auto-auth'].enabled) {
          const password = config.utils['auto-auth'].password;
          pendingPromise = pendingPromise
            .then(() => sendRegister(password))
            .then(() => sendLogin(password))
            .catch(console.error);
        }

        // Chat messages
        if (config.utils['chat-messages'].enabled) {
          const messages = config.utils['chat-messages'].messages;
          if (config.utils['chat-messages'].repeat) {
            const delay = config.utils['chat-messages']['repeat-delay'];
            let i = 0;
            setInterval(() => {
              try {
                bot.chat(messages[i]);
                i = (i + 1) % messages.length;
              } catch (err) {
                console.error(`[Chat Msg Error] ${err.message}`);
              }
            }, delay * 1000);
          } else {
            messages.forEach(msg => bot.chat(msg));
          }
        }

        // Move to position
        if (config.position.enabled) {
          const pos = config.position;
          console.log(`[AfkBot] Moving to (${pos.x}, ${pos.y}, ${pos.z})`);
          bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
        }

        // Anti-AFK
        if (config.utils['anti-afk'].enabled) {
          bot.setControlState('jump', true);
          if (config.utils['anti-afk'].sneak) {
            bot.setControlState('sneak', true);
          }
        }

        // Wander
        if (config['movement-area'].enabled) {
          const center = config['movement-area'].center;
          const range = config['movement-area'].range;
          const interval = config['movement-area'].interval * 1000;

          function getRandomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
          }

          function getSafeY(x, z) {
            for (let y = 256; y > 0; y--) {
              try {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (block && block.boundingBox !== 'empty') return y + 1;
              } catch (err) {
                // ignore
              }
            }
            return center.y;
          }

          function moveRandomly() {
            try {
              const x = getRandomInt(center.x - range, center.x + range);
              const z = getRandomInt(center.z - range, center.z + range);
              const y = getSafeY(x, z);
              console.log(`[INFO] Wandering to (${x}, ${y}, ${z})`);
              bot.pathfinder.setGoal(new GoalBlock(x, y, z));
            } catch (err) {
              console.error(`[Wander Error] ${err.message}`);
            } finally {
              setTimeout(moveRandomly, interval);
            }
          }

          moveRandomly();
        }
      } catch (err) {
        console.error(`[Spawn Error] ${err.message}`);
      }
    });

    bot.on('chat', (username, message) => {
      try {
        if (message === 'quit' && !reconnecting) {
          reconnecting = true;
          quitting = true;
          console.log('[INFO] Quit command received. Quitting...');
          bot.quit();
        }
      } catch (err) {
        console.error(`[Chat Command Error] ${err.message}`);
      }
    });

    bot.on('goal_reached', () => {
      console.log(`[AfkBot] Reached destination: ${bot.entity.position}`);
    });

    bot.on('death', () => {
      console.log(`[AfkBot] Bot died. Respawned at: ${bot.entity.position}`);
    });

    if (config.utils['auto-reconnect']) {
      bot.on('end', () => {
        if (!realPlayerDetected) {
          botjoining = false;
          setTimeout(() => {
            console.log('[INFO] Attempting bot reconnect...');
            createBot();
          }, 20000);
        }
      });
    }

    bot.on('kicked', reason => {
      console.log(`[AfkBot] Bot was kicked. Reason: ${reason}`);
    });

    bot.on('error', err => {
      console.error(`[ERROR] ${err.message}`);
    });
  } catch (err) {
    console.error(`[Bot Creation Error] ${err.message}`);
  }
}

setInterval(checkPlayers, 2000);
checkPlayers();
