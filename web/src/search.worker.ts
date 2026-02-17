import uniqBy from 'lodash.uniqby';
import MiniSearch, { SearchResult } from 'minisearch'
import Meme from './Meme'

let index: MiniSearch
let descIndex: MiniSearch | null = null
let criteria = ''

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
  const dbPromise = fetch(`${process.env.REACT_APP_ASSETS_URL}/db.json`).then((res) => res.text())
  const descPromise = fetch(`${process.env.REACT_APP_ASSETS_URL}/descriptions.json`)
    .then((res) => {
      if (!res.ok) return null
      return res.text()
    })
    .catch(() => null)

  const [data, descData] = await Promise.all([dbPromise, descPromise])

  // minisearch configuration must match datamaker's
  index = MiniSearch.loadJSON(data, {
    idField: 'photo',
    fields: ['text'],
    storeFields: ['date_unixtime', 'photo', 'width', 'height', 'text'],
    searchOptions: {
      combineWith: 'AND',
      prefix: true
    }
  })

  const jsonData = JSON.parse(data)
  const storedFields: Record<string, Meme> = jsonData.storedFields
  // Build lookup for merging description-only results with meme metadata
  storedFieldsMap = {}
  for (const [key, doc] of Object.entries(storedFields)) {
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
