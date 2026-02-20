import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';
import MiniSearch from 'minisearch'
import { Storage } from '@google-cloud/storage';
import { getTextAndLanguage } from './text.js'

const token = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(token);
const storage = new Storage();
const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET);

function extractReactions(reactionsSource) {
  const reactions = reactionsSource?.results || reactionsSource?.reactions;
  if (!Array.isArray(reactions)) return [];

  return reactions
    .map((reaction) => {
      const emoji = reaction?.type?.emoji || reaction?.emoji;
      const count = Number(reaction?.total_count ?? reaction?.count ?? 0);
      if (!emoji || count <= 0) return null;
      return { emoji, count };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);
}

function getMessageKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

function toStringOrEmpty(value) {
  return value === undefined || value === null ? '' : String(value);
}

function getUpdateMessage(update) {
  return (
    update.message ||
    update.channel_post ||
    update.edited_message ||
    update.edited_channel_post
  );
}

(async () => {
  const [dbCompressed] = await bucket.file(`db.json`).download()
  const db = gunzipSync(dbCompressed)
  const miniSearch = MiniSearch.loadJSON(db.toString(), {
    idField: 'photo',
    fields: ['text'],
    storeFields: ['date_unixtime', 'photo', 'width', 'height', 'chat_id', 'message_id', 'reactions'],
  });
  const reactionOverridesByKey = new Map();
  const existingDocsByPhoto = new Map();
  for (const doc of Object.values(miniSearch.toJSON().storedFields || {})) {
    if (doc?.photo) {
      existingDocsByPhoto.set(doc.photo, doc);
    }
  }

  let offset;
  while (true) {
    const updates = await bot.getUpdates({
      offset,
      allowed_updates: JSON.stringify([
        'message',
        'channel_post',
        'edited_message',
        'edited_channel_post',
        'message_reaction_count',
      ]),
    });
    if (updates.length === 0) break;
    for (const update of updates) {
      console.log(`processsing update ${JSON.stringify(update)}`);
      offset = update.update_id + 1;

      const reactionUpdate = update.message_reaction_count;
      if (reactionUpdate) {
        const chatId = toStringOrEmpty(reactionUpdate.chat?.id);
        const messageId = toStringOrEmpty(reactionUpdate.message_id);
        const key = getMessageKey(chatId, messageId);
        if (chatId && messageId) {
          reactionOverridesByKey.set(key, extractReactions(reactionUpdate));
          console.log(`updated reactions for ${chatId}/${messageId}`);
        }
        continue;
      }

      const message = getUpdateMessage(update);
      if (!message) continue;
      const photos = message.photo;
      if (!photos) continue;
      const { width, height, file_id, file_unique_id } = photos[photos.length-1];
      const chatId = toStringOrEmpty(message.chat?.id);
      const messageId = toStringOrEmpty(message.message_id);
      const file = await bot.getFile(file_id);
      if (!file.file_path) continue;
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`
      const req = await fetch(url)
      const data = Buffer.from(await req.arrayBuffer());

      const photo = `photos/${file_unique_id}`
      await bucket.file(photo).save(data);

      const { text } = await getTextAndLanguage(data);
      await bucket.file(`${photo}.txt`).save(text, {
        metadata: {
          cacheControl: 'public, max-age=31536000, immutable',
          contentType: 'text/plain; charset=utf-8',
        }
      });
      const existingDoc = existingDocsByPhoto.get(photo);
      const resolvedChatId = chatId || existingDoc?.chat_id || '';
      const resolvedMessageId = messageId || existingDoc?.message_id || '';
      if (!resolvedChatId || !resolvedMessageId) {
        console.warn(
          `missing chat/message id for update ${update.update_id}, photo ${photo}`
        );
      }

      const doc = {
        date_unixtime: message.date + '',
        photo,
        width,
        height,
        chat_id: resolvedChatId,
        message_id: resolvedMessageId,
        reactions: extractReactions(message.reactions || message.reaction_count),
        text
      };

      console.log('adding meme');
      if (existingDoc) {
        miniSearch.remove(existingDoc);
        miniSearch.add(doc);
      } else {
        miniSearch.add(doc);
      }
      existingDocsByPhoto.set(photo, doc);
    }
  }
  const json = miniSearch.toJSON();
  if (reactionOverridesByKey.size > 0) {
    for (const doc of Object.values(json.storedFields || {})) {
      if (!doc?.chat_id || !doc?.message_id) continue;
      const key = getMessageKey(doc.chat_id, doc.message_id);
      const reactions = reactionOverridesByKey.get(key);
      if (reactions) {
        doc.reactions = reactions;
      }
    }
  }
  const jsonStr = JSON.stringify(json);
  const compressed = gzipSync(jsonStr);
  await bucket.file(`db.json`).save(compressed, {
    metadata: {
      cacheControl: 'no-cache',
      contentType: 'application/json',
    }
  });

  const hash = createHash('md5').update(jsonStr).digest('hex');
  await bucket.file('db.version.json').save(JSON.stringify({ hash, updatedAt: Date.now() }), {
    metadata: {
      cacheControl: 'no-cache',
      contentType: 'application/json',
    }
  });
})();
