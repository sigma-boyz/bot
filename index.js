const { createBot } = require('@nxg-org/mineflayer-alt');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(8000, () => console.log('[HTTP] Status server running on port 8000'));

function startBot() {
  const bot = createBot({
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

  async function autoAuth(password) {
    bot.chat(`/register ${password} ${password}`);
    console.log('[Auth] Sent /register');
    bot.once('chat', (username, message) => {
      console.log(`[Chat] <${username}> ${message}`);
      if (message.includes('successfully') || message.includes('already')) {
        bot.chat(`/login ${password}`);
        console.log('[Auth] Sent /login');
      }
    });
  }

  bot.once('spawn', () => {
    console.log('[Bot] Spawned and connected.');

    if (config.utils['auto-auth'].enabled) {
      autoAuth(config.utils['auto-auth'].password);
    }

    if (config.utils['chat-messages'].enabled) {
      const messages = config.utils['chat-messages']['messages'];
      if (config.utils['chat-messages'].repeat) {
        let i = 0;
        setInterval(() => {
          bot.chat(messages[i]);
          i = (i + 1) % messages.length;
        }, config.utils['chat-messages']['repeat-delay'] * 1000);
      } else {
        messages.forEach(msg => bot.chat(msg));
      }
    }

    if (config.position.enabled) {
      console.log(`[Move] Going to (${config.position.x}, ${config.position.y}, ${config.position.z})`);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(config.position.x, config.position.y, config.position.z));
    }

    if (config.utils['anti-afk'].enabled) {
      bot.setControlState('jump', true);
      if (config.utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
      }
    }
  });

  bot.on('goal_reached', () => {
    console.log('[Bot] Arrived at goal:', bot.entity.position);
  });

  bot.on('death', () => {
    console.log('[Bot] Died and will respawn.');
  });

  bot.on('kicked', reason => {
    console.log('[KICKED]', reason);
  });

  bot.on('error', err => {
    console.log('[ERROR]', err.message);
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log('[Reconnect] Disconnected, will reconnect...');
      setTimeout(startBot, config.utils['auto-recconect-delay']);
    });
  }
}

startBot();
