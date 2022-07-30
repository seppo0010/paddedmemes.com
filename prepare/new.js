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
  const db = await bucket.file(`db.json`).download()
  const miniSearch = MiniSearch.loadJSON(db[0], {
    idField: 'photo',
    fields: ['text'],
    storeFields: ['date_unixtime', 'photo', 'width', 'height', 'text'],
  });

  let offset;
  while (true) {
    const updates = await bot.getUpdates({ offset });
    if (updates.length === 0) break;
    for (const update of updates) {
      offset = update.update_id + 1;
      const photos = update && update.message && update.message.photo;
      if (!photos) continue;
      const { width, height, file_id, file_unique_id } = photos[photos.length-1];
      const file = await bot.getFile(file_id);
      if (!file.file_path) continue;
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`
      const req = await fetch(url)
      const data = Buffer.from(await req.arrayBuffer());

      await bucket.file(`photos/${file_unique_id}`).save(data);

      const { text } = await getTextAndLanguage(data);
      continue
      miniSearch.add({
        date_unixtime: update.message.date + '',
        photo,
        width,
        height,
        text
      })
    }
  }
  await bucket.file(`db.json`).save(JSON.stringify(miniSearch));
})();
