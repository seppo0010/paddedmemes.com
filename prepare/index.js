import * as fs from 'fs';
import util from 'node:util';
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
}

const miniSearch = new MiniSearch({
  idField: 'photo',
  fields: ['text'],
  storeFields: ['date_unixtime', 'photo', 'width', 'height', 'text'],
})
miniSearch.addAll(photos);
fs.writeFileSync(`${base_dir}/db.json`, JSON.stringify(miniSearch));

})()
