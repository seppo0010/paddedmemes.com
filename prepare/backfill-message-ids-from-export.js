import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

const bucketName = process.env.GCLOUD_STORAGE_BUCKET;
if (!bucketName) {
  throw new Error('GCLOUD_STORAGE_BUCKET is required');
}

const exportPath = path.resolve(process.cwd(), process.argv[2] || '../result.json');
const apply = process.argv.includes('--apply');
if (!fs.existsSync(exportPath)) {
  throw new Error(`Export file not found: ${exportPath}`);
}

function toChannelChatId(exportData) {
  const channelId = String(exportData.id || '');
  if (!channelId) {
    throw new Error('Export file does not contain channel id');
  }
  if (channelId.startsWith('-100')) return channelId;
  if (channelId.startsWith('-')) return channelId;
  return `-100${channelId}`;
}

function getKey(dateUnixtime, width, height) {
  return `${dateUnixtime}|${width}|${height}`;
}

function buildMessageIndex(exportData) {
  const map = new Map();
  for (const message of exportData.messages || []) {
    if (message?.type !== 'message') continue;
    if (!message?.photo) continue;
    if (!message?.date_unixtime || !message?.width || !message?.height || !message?.id) continue;
    const key = getKey(String(message.date_unixtime), Number(message.width), Number(message.height));
    const list = map.get(key) || [];
    list.push(String(message.id));
    map.set(key, list);
  }
  return map;
}

(async () => {
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const chatId = toChannelChatId(exportData);
  const messageIndex = buildMessageIndex(exportData);

  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const [dbCompressed] = await bucket.file('db.json').download();
  const dbJson = JSON.parse(gunzipSync(dbCompressed).toString());
  const storedFields = dbJson.storedFields || {};

  let totalDocs = 0;
  let alreadyMapped = 0;
  let mappedNow = 0;
  let noMatch = 0;
  let ambiguous = 0;
  const ambiguousKeys = new Set();

  for (const doc of Object.values(storedFields)) {
    if (!doc?.photo) continue;
    totalDocs += 1;

    if (doc.chat_id && doc.message_id) {
      alreadyMapped += 1;
      continue;
    }

    const key = getKey(String(doc.date_unixtime), Number(doc.width), Number(doc.height));
    const candidates = messageIndex.get(key) || [];

    if (candidates.length === 0) {
      noMatch += 1;
      continue;
    }

    if (candidates.length > 1) {
      ambiguous += 1;
      ambiguousKeys.add(key);
      continue;
    }

    doc.chat_id = chatId;
    doc.message_id = candidates[0];
    mappedNow += 1;
  }

  const reportPath = path.resolve(process.cwd(), 'backfill-message-ids-report.json');
  const report = {
    exportPath,
    apply,
    chatId,
    totalDocs,
    alreadyMapped,
    mappedNow,
    noMatch,
    ambiguous,
    ambiguousKeys: Array.from(ambiguousKeys).slice(0, 200),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (apply) {
    const jsonStr = JSON.stringify(dbJson);
    const compressed = gzipSync(jsonStr);
    await bucket.file('db.json').save(compressed, {
      metadata: {
        cacheControl: 'no-cache',
        contentType: 'application/json',
      },
    });

    const hash = createHash('md5').update(jsonStr).digest('hex');
    await bucket.file('db.version.json').save(JSON.stringify({ hash, updatedAt: Date.now() }), {
      metadata: {
        cacheControl: 'no-cache',
        contentType: 'application/json',
      },
    });
  }

  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote report: ${reportPath}`);
})();
