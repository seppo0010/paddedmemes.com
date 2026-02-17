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


(async () => {
  const [dbCompressed] = await bucket.file(`db.json`).download()
  const db = gunzipSync(dbCompressed)
  const miniSearch = MiniSearch.loadJSON(db.toString(), {
    idField: 'photo',
    fields: ['text'],
    storeFields: ['date_unixtime', 'photo', 'width', 'height'],
  });

  let offset;
  while (true) {
    const updates = await bot.getUpdates({ offset });
    if (updates.length === 0) break;
    for (const update of updates) {
      console.log(`processsing update ${JSON.stringify(update)}`);
      offset = update.update_id + 1;
      const message = update.message || update.channel_post;
      if (!message) continue;
      const photos = message.photo;
      if (!photos) continue;
      const { width, height, file_id, file_unique_id } = photos[photos.length-1];
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
      console.log('adding meme');
      miniSearch.add({
        date_unixtime: message.date + '',
        photo,
        width,
        height,
        text
      })
    }
  }
  const jsonStr = JSON.stringify(miniSearch);
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
