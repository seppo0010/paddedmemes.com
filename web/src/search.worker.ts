import MiniSearch, { SearchResult } from 'minisearch'

let index: MiniSearch
let criteria = ''

const doSearch = () => {
  if (!index) return
  const c = criteria.split(' ').filter((x) => x.length >= 3).join(' ')
  if (c === '') {
    global.self.postMessage(['setDidSearch', false])
    global.self.postMessage(['setSearchResults', []])
    return
  }
  const results = index.search(criteria)
  const filtered = results.filter((tag, index, array) => array.findIndex((doc: SearchResult) => tag.photo === doc.photo) === index)
  global.self.postMessage(['setDidSearch', true])
  global.self.postMessage(['setSearchResults', filtered.slice(0, 40)])
}

export async function init () {
  fetch(`${process.env.REACT_APP_ASSETS_URL}/db.json`)
    .then((res) => res.text())
    // minisearch configuration must match datamaker's
    .then((data) => {
      index = MiniSearch.loadJSON(data, {
        idField: 'photo',
        fields: ['text'],
        storeFields: ['date_unixtime', 'photo', 'width', 'height', 'text'],
        searchOptions: {
          combineWith: 'AND',
          prefix: true
        }
      })
      global.self.postMessage(['setReady', true])
      doSearch()
    })
    // TODO: handle error
}

export async function search (searchCriteria: string) {
  criteria = searchCriteria
  doSearch()
}
