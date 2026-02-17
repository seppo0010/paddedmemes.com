import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import fetch from 'node-fetch';
import MiniSearch from 'minisearch'
import { Storage } from '@google-cloud/storage';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';

const storage = new Storage();
const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET);

const descriptionsConfig = {
  idField: 'photo',
  fields: ['description'],
  storeFields: ['photo', 'description_en', 'description_es'],
};

async function describeImage(imageBuffer, prompt) {
  const base64 = imageBuffer.toString('base64');
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [base64],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  let text = data.response.trim();
  // Strip markdown bold markers
  text = text.replace(/\*\*/g, '');
  // Remove common LLM preamble lines
  text = text.replace(/^(?:here(?:'s| is)[^\n]*:\s*\n*)/i, '');
  // Remove trailing follow-up questions
  text = text.replace(/\n+(?:would you|let me|do you|shall i|if you|feel free|i can also)[^\n]*$/i, '');
  return text.trim();
}

async function loadDescriptionsIndex() {
  try {
    const [data] = await bucket.file('descriptions.json').download();
    const decompressed = gunzipSync(data);
    return MiniSearch.loadJSON(decompressed.toString(), descriptionsConfig);
  } catch (e) {
    if (e.code === 404) return new MiniSearch(descriptionsConfig);
    throw e;
  }
}

async function uploadDescriptions(miniSearch) {
  const jsonStr = JSON.stringify(miniSearch);
  const compressed = gzipSync(jsonStr);
  await bucket.file('descriptions.json').save(compressed, {
    metadata: {
      cacheControl: 'no-cache',
      contentType: 'application/json',
    },
  });

  const hash = createHash('md5').update(jsonStr).digest('hex');
  await bucket.file('descriptions.version.json').save(JSON.stringify({ hash, updatedAt: Date.now() }), {
    metadata: {
      cacheControl: 'no-cache',
      contentType: 'application/json',
    },
  });
}

(async () => {
  console.log(`Using model: ${MODEL}, batch size: ${BATCH_SIZE}`);

  // Load main db to get all photo IDs
  const [dbDataCompressed] = await bucket.file('db.json').download();
  const dbJson = JSON.parse(gunzipSync(dbDataCompressed).toString());
  const allPhotos = Object.values(dbJson.storedFields).map((doc) => doc.photo);
  console.log(`Total memes in db: ${allPhotos.length}`);

  // Load existing descriptions index
  const descIndex = await loadDescriptionsIndex();
  const described = new Set();
  const descJson = JSON.parse(JSON.stringify(descIndex));
  if (descJson.storedFields) {
    for (const doc of Object.values(descJson.storedFields)) {
      described.add(doc.photo);
    }
  }
  console.log(`Already described: ${described.size}`);

  // Filter to undescribed
  const todo = allPhotos.filter((photo) => !described.has(photo));
  console.log(`To describe: ${todo.length}`);

  if (todo.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let processed = 0;
  const batch = todo.slice(0, BATCH_SIZE);
  for (const photo of batch) {
    try {
      const [imageData] = await bucket.file(photo).download();
      const [descEn, descEs] = await Promise.all([
        describeImage(imageData, 'Describe this meme image in one sentence for search indexing. Reply with ONLY the sentence, no preamble, no formatting, no follow-up.'),
        describeImage(imageData, 'Describí esta imagen de meme en una oración para indexación de búsqueda. Respondé SOLO con la oración, sin preámbulo, sin formato, sin seguimiento.'),
      ]);
      descIndex.add({
        photo,
        description: `${descEn} ${descEs}`,
        description_en: descEn,
        description_es: descEs,
      });
      processed++;
      console.log(`[${described.size + processed}/${allPhotos.length}] ${photo}: ${descEn}`);
    } catch (e) {
      console.error(`Error processing ${photo}: ${e.message}`);
    }
  }
  // Upload after the batch
  await uploadDescriptions(descIndex);
  console.log(`Batch uploaded. Progress: ${described.size + processed}/${allPhotos.length}`);

  console.log(`Done. Described ${processed} new memes.`);
})();
