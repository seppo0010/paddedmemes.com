import uniqBy from 'lodash.uniqby';
import MiniSearch, { SearchResult } from 'minisearch'
import Meme from './Meme'

let index: MiniSearch
let descIndex: MiniSearch | null = null
let criteria = ''

const CACHE_NAME = 'paddedmemes-v1'
const ASSETS_URL = process.env.REACT_APP_ASSETS_URL

async function fetchWithCache(name: string, versionName: string): Promise<string> {
  const cache = await caches.open(CACHE_NAME)
  const versionUrl = `${ASSETS_URL}/${versionName}`
  const dataUrl = `${ASSETS_URL}/${name}`

  // Fetch the small version file (always fresh, no-cache)
  const versionRes = await fetch(versionUrl)
  const remoteVersion = versionRes.ok ? await versionRes.json() : null

  // Try to load from cache
  if (remoteVersion) {
    const cachedVersion = await cache.match(versionUrl)
    if (cachedVersion) {
      const localVersion = await cachedVersion.json()
      if (localVersion.hash === remoteVersion.hash) {
        const cachedData = await cache.match(dataUrl)
        if (cachedData) {
          return cachedData.text()
        }
      }
    }
  }

  // Cache miss or version mismatch — fetch fresh data
  const dataRes = await fetch(dataUrl)
  const ds = new (globalThis as any).DecompressionStream('gzip')
  const decompressed = dataRes.body!.pipeThrough(ds)
  const text = await new Response(decompressed).text()

  // Store both in cache
  await cache.put(dataUrl, new Response(text))
  if (remoteVersion) {
    await cache.put(versionUrl, new Response(JSON.stringify(remoteVersion)))
  }

  return text
}

const doSearch = () => {
  if (!index) return
  const c = criteria.split(' ').filter((x) => x.length >= 3).join(' ')
  if (c === '') {
    global.self.postMessage(['setDidSearch', false])
    global.self.postMessage(['setSearchResults', []])
    return
  }
  const textResults = index.search(criteria)
  let allResults: SearchResult[] = textResults
  if (descIndex) {
    const descResults = descIndex.search(criteria)
    // Merge: combine scores for items found in both, union otherwise
    const scoreMap = new Map<string, SearchResult>()
    for (const r of textResults) {
      scoreMap.set(r.photo, r)
    }
    for (const r of descResults) {
      const existing = scoreMap.get(r.photo)
      if (existing) {
        existing.score += r.score
      } else {
        scoreMap.set(r.photo, { ...r, ...getStoredFields(r.photo) })
      }
    }
    allResults = Array.from(scoreMap.values()).sort((a, b) => b.score - a.score)
  }
  const filtered = allResults.filter((tag, idx, array) => array.findIndex((doc: SearchResult) => tag.photo === doc.photo) === idx)
  global.self.postMessage(['setDidSearch', true])
  global.self.postMessage(['setSearchResults', filtered.slice(0, 40)])
}

let storedFieldsMap: Record<string, Meme> = {}

function getStoredFields(photo: string): Partial<Meme> {
  return storedFieldsMap[photo] || {}
}

export async function init () {
  const dbPromise = fetchWithCache('db.json', 'db.version.json')
  const descPromise = fetchWithCache('descriptions.json', 'descriptions.version.json')
    .catch(() => null)

  const [data, descData] = await Promise.all([dbPromise, descPromise])

  // minisearch configuration must match datamaker's
  index = MiniSearch.loadJSON(data, {
    idField: 'photo',
    fields: ['text'],
    storeFields: ['date_unixtime', 'photo', 'width', 'height'],
    searchOptions: {
      combineWith: 'AND',
      prefix: true
    }
  })

  const jsonData = JSON.parse(data)
  const storedFields: Record<string, Meme> = jsonData.storedFields
  // Build lookup for merging description-only results with meme metadata
  storedFieldsMap = {}
  for (const [, doc] of Object.entries(storedFields)) {
    storedFieldsMap[doc.photo] = doc
  }

  if (descData) {
    descIndex = MiniSearch.loadJSON(descData, {
      idField: 'photo',
      fields: ['description'],
      storeFields: ['photo', 'description_en', 'description_es'],
      searchOptions: {
        combineWith: 'AND',
        prefix: true
      }
    })
  }

  const defaultResults = uniqBy(Object.values(storedFields), (f) => f.photo)
    .sort((a, b) => - parseInt(a.date_unixtime, 10) + parseInt(b.date_unixtime, 10))
    .slice(0, 40)
  global.self.postMessage(['setReady', true])
  global.self.postMessage(['setDefaultResults', defaultResults])

  doSearch()
}

export async function search (searchCriteria: string) {
  criteria = searchCriteria
  doSearch()
}

export async function autoSuggest (query: string) {
  if (!index || query.trim().length < 2) {
    global.self.postMessage(['setSuggestions', []])
    return
  }
  const opts = { combineWith: 'AND' as const, prefix: true }
  const textSuggestions = index.autoSuggest(query, opts)
  let allSuggestions = textSuggestions
  if (descIndex) {
    const descSuggestions = descIndex.autoSuggest(query, opts)
    const seen = new Set(textSuggestions.map(s => s.suggestion))
    for (const s of descSuggestions) {
      if (!seen.has(s.suggestion)) {
        allSuggestions.push(s)
      }
    }
    allSuggestions.sort((a, b) => b.score - a.score)
  }
  global.self.postMessage(['setSuggestions', allSuggestions.slice(0, 5).map(s => s.suggestion)])
}
