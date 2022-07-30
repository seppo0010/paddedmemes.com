import * as fs from 'fs';
import util from 'node:util';
import { spawn } from 'node:child_process'
import { franc, francAll } from 'franc'
import tqdm from 'tqdm';

(async () => {

function readImage(path, language) {
  return new Promise((resolve, reject) => {
    let data = '';
    const subprocess = spawn('tesseract', ['-l', language, '-', '-']);
    subprocess.stdin.write(fs.readFileSync(path));
    subprocess.stdin.end();
    subprocess.stdout.on('data', (newdata) => data += newdata);
    subprocess.stdout.on('close', () => resolve(data));
  });
}

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
  photo.text = null;
  photo.language = null;
  const [eng, spa] = await Promise.all([
    readImage(`${base_dir}/${photo.photo}`, 'eng'),
    readImage(`${base_dir}/${photo.photo}`, 'spa'),
  ]);
  try {
    const [[p0name, p0score], [p1name, p1score]] = francAll(eng, { only: ['eng', 'spa'] })
    const [[q0name, q0score], [q1name, q1score]] = francAll(spa, { only: ['eng', 'spa'] })
    const scores = {eng: 0, spa: 0};
    scores[p0name] += p0score;
    scores[p1name] += p1score;
    scores[q0name] += q0score;
    scores[q1name] += q1score;
    if (scores.eng > scores.spa) {
      photo.text = eng;
      photo.language = 'eng';
    } else {
      photo.text = spa;
      photo.language = 'spa';
    }
  } catch (e) {}
  fs.writeFileSync(photoDataPath, JSON.stringify(photo));
}
console.log(JSON.stringify({ photos }));

})()
