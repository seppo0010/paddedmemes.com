import * as fs from 'fs';
import { spawn } from 'node:child_process'
import { francAll } from 'franc'

function readImage(pathOrData, language) {
  return new Promise((resolve, reject) => {
    let data = '';
    const subprocess = spawn('tesseract', ['-l', language, '-', '-']);
    subprocess.stdin.write(typeof pathOrData === 'string' ? fs.readFileSync(pathOrData) : pathOrData);
    subprocess.stdin.end();
    subprocess.stdout.on('data', (newdata) => data += newdata);
    subprocess.stdout.on('close', () => resolve(data));
  });
}

export async function getTextAndLanguage(pathOrData) {
  let text = null;
  let language = null;
  const eng = await readImage(pathOrData, 'eng')
  const spa = await readImage(pathOrData, 'spa')
  try {
    const [[p0name, p0score], [p1name, p1score]] = francAll(eng, { only: ['eng', 'spa'] })
    const [[q0name, q0score], [q1name, q1score]] = francAll(spa, { only: ['eng', 'spa'] })
    const scores = {eng: 0, spa: 0};
    scores[p0name] += p0score;
    scores[p1name] += p1score;
    scores[q0name] += q0score;
    scores[q1name] += q1score;
    if (scores.eng > scores.spa) {
      text = eng;
      language = 'eng';
    } else {
      text = spa;
      language = 'spa';
    }
  } catch (e) {}
  return { text, language }
}
