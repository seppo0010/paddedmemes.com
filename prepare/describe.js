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
  return data.response.trim();
}

async function loadDescriptionsIndex() {
  try {
    const [data] = await bucket.file('descriptions.json').download();
    return MiniSearch.loadJSON(data.toString(), descriptionsConfig);
  } catch (e) {
    if (e.code === 404) return new MiniSearch(descriptionsConfig);
    throw e;
  }
}

async function uploadDescriptions(miniSearch) {
  await bucket.file('descriptions.json').save(JSON.stringify(miniSearch), {
    metadata: { cacheControl: 'no-cache' },
  });
}

(async () => {
  console.log(`Using model: ${MODEL}, batch size: ${BATCH_SIZE}`);

  // Load main db to get all photo IDs
  const [dbData] = await bucket.file('db.json').download();
  const dbJson = JSON.parse(dbData.toString());
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
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    for (const photo of batch) {
      try {
        const [imageData] = await bucket.file(photo).download();
        const [descEn, descEs] = await Promise.all([
          describeImage(imageData, 'Describe this meme image in one sentence for search indexing.'),
          describeImage(imageData, 'Describí esta imagen de meme en una oración para indexación de búsqueda.'),
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
    // Upload after each batch
    await uploadDescriptions(descIndex);
    console.log(`Batch uploaded. Progress: ${described.size + processed}/${allPhotos.length}`);
  }

  console.log(`Done. Described ${processed} new memes.`);
})();
