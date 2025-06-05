const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(8000, () => {
  console.log('Server started');
});
let reconnecting = false
let quitting = false
function createBot() {
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

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register command.`);

      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);

        if (message.includes('successfully registered')) {
          console.log('[INFO] Registration confirmed.');
          resolve();
        } else if (message.includes('already registered')) {
          console.log('[INFO] Bot was already registered.');
          resolve();
        } else if (message.includes('Invalid command')) {
          reject(`Registration failed: Invalid command. Message: "${message}"`);
        } else {
          reject(`Registration failed: unexpected message "${message}".`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login command.`);

      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);

        if (message.includes('successfully logged in')) {
          console.log('[INFO] Login successful.');
          resolve();
        } else if (message.includes('Invalid password')) {
          reject(`Login failed: Invalid password. Message: "${message}"`);
        } else if (message.includes('not registered')) {
          reject(`Login failed: Not registered. Message: "${message}"`);
        } else {
          reject(`Login failed: unexpected message "${message}".`);
        }
      });
    });
  }
  bot.on("chat",(username,message) =>{
    if(message === "quit"){
      console.log("quitting")
      if(!reconnecting){
        reconnecting = true
        quitting = true
        bot.quit()
        console.log("bot quit")
  
        setTimeout(() =>{
          createBot()
          console.log("BOT reconnected")
        },20000)}
    }
  })
  bot.once('spawn', () => {
    console.log('\x1b[33m[AfkBot] Bot joined the server\x1b[0m');
    reconnecting = false
  quitting = false
    bot.pathfinder.setMovements(defaultMove);

    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Started auto-auth module');

      const password = config.utils['auto-auth'].password;

      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error));
    }

    if (config.utils['chat-messages'].enabled) {
      console.log('[INFO] Started chat-messages module');
      const messages = config.utils['chat-messages']['messages'];

      if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;

        setInterval(() => {
          bot.chat(`${messages[i]}`);

          if (i + 1 === messages.length) {
            i = 0;
          } else {
            i++;
          }
        }, delay * 1000);
      } else {
        messages.forEach((msg) => {
          bot.chat(msg);
        });
      }
    }

    if (config.position.enabled) {
      const pos = config.position;
      console.log(
        `\x1b[32m[Afk Bot] Starting to move to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
      );
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      bot.setControlState('jump', true);
      if (config.utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
      }
    }

    // --- Movement area wandering logic ---
    if (config['movement-area'].enabled) {
      console.log('[INFO] Movement area enabled, bot will wander.');

      const center = config['movement-area'].center;
      const range = config['movement-area'].range;
      const interval = config['movement-area'].interval * 1000; // convert to ms

      function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      function getSafeY(x, z) {
        // Start from max height going down to find solid block
        for (let y = 256; y > 0; y--) {
          const block = bot.blockAt({ x, y, z });
          if (block && block.boundingBox !== 'empty') {
            return y + 1; // one block above ground
          }
        }
        return center.y; // fallback
      }

      function moveRandomly() {
        const x = getRandomInt(center.x - range, center.x + range);
        const z = getRandomInt(center.z - range, center.z + range);
        const y = getSafeY(x, z);

        console.log(`[INFO] Moving to random position (${x}, ${y}, ${z})`);
        bot.pathfinder.setGoal(new GoalBlock(x, y, z));

        setTimeout(moveRandomly, interval);
      }

      moveRandomly();
    }
  });

  bot.on('goal_reached', () => {
    console.log(
      `\x1b[32m[AfkBot] Bot arrived at the target location. ${bot.entity.position}\x1b[0m`
    );
  });

  bot.on('death', () => {
    console.log(
      `\x1b[33m[AfkBot] Bot has died and was respawned at ${bot.entity.position}\x1b[0m`
    );
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      if(!reconnecting && !quitting){
        reconnecting = true
        setTimeout(() => {
          createBot();
        }, config.utils['auto-reconnect-delay']);
      }
    });
  }

  bot.on('kicked', (reason) =>
    console.log(
      '\x1b[33m',
      `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`,
      '\x1b[0m'
    )
  );

  bot.on('error', (err) =>
    console.log(`\x1b[31m[ERROR] ${err.message}\x1b[0m`)
  );
}

createBot();
