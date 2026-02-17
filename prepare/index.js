import * as fs from 'fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import tqdm from 'tqdm';
import MiniSearch from 'minisearch'
import { getTextAndLanguage } from './text.js'

(async () => {

const base_dir = process.env.PREPARE_PATH || './data';
const { messages } = JSON.parse(fs.readFileSync(`${base_dir}/result.json`));
const photos = messages
  .filter(({ photo }) => !!photo)
  .map(({ date_unixtime, photo, width, height }) => ({ date_unixtime, photo, width, height }));

for (const [i, photo] of tqdm(photos.entries(), { total: photos.length })) {
  const photoDataPath = `${base_dir}/${photo.photo}.json`;
  if (fs.existsSync(photoDataPath)) {
    photos[i] = JSON.parse(fs.readFileSync(photoDataPath));
    continue;
  }
  const { text, language } = await getTextAndLanguage(`${base_dir}/${photo.photo}`);
  photo.text = text;
  photo.language = language;
  fs.writeFileSync(photoDataPath, JSON.stringify(photo));
  fs.writeFileSync(`${base_dir}/${photo.photo}.txt`, text);
}

const miniSearch = new MiniSearch({
  idField: 'photo',
  fields: ['text'],
  storeFields: ['date_unixtime', 'photo', 'width', 'height'],
})
miniSearch.addAll(photos);
const jsonStr = JSON.stringify(miniSearch);
fs.writeFileSync(`${base_dir}/db.json`, gzipSync(jsonStr));

const hash = createHash('md5').update(jsonStr).digest('hex');
fs.writeFileSync(`${base_dir}/db.version.json`, JSON.stringify({ hash, updatedAt: Date.now() }));

})()
