import * as fs from 'fs';
import { spawn } from 'node:child_process'
import { francAll } from 'franc'

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

export async function getTextAndLanguage(path) {
  let text = null;
  let language = null;
  const eng = await readImage(path, 'eng')
  const spa = await readImage(path, 'spa')
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
  return { text, language }
}
