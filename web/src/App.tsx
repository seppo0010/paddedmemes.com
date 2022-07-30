import React, { useState, useEffect } from 'react';
import Meme from './Meme'
import './App.css';

// eslint-disable-next-line import/no-webpack-loader-syntax
const Worker = require('workerize-loader!./search.worker')

function App() {
  const [loading, setLoading] = useState(false)
  const [workerInstance, setWorkerInstance] = useState<any | null>(null)
  const [searchResults, setSearchResults] = useState<Meme[]>([])
  const [searchCriteria, setSearchCriteria] = useState('')
  const [didSearch, setDidSearch] = useState(false)

  useEffect(() => {
    if (workerInstance) return
    const w = new Worker()
    setWorkerInstance(w)
  }, [workerInstance])

  const processMessage = ({ data }: any) => {
    // I don't know why `const [t, params] = data` does not work
    const [t, params] = [data[0], data[1]]
    if (!t) return
    switch (t) {
      case 'setSearchResults': setSearchResults(params); break
      case 'setDidSearch': setDidSearch(params); break
      default: console.error('unexpected message type: ' + t); break
    }
  }

  useEffect(() => {
    if (!workerInstance) return
    workerInstance.addEventListener('message', processMessage)
    return () => workerInstance.removeEventListener('message', processMessage)
  })

  useEffect(() => {
    if (loading || !workerInstance) return
    setLoading(true)

    workerInstance.init()
  }, [loading, workerInstance])

  useEffect(() => {
    workerInstance?.search(searchCriteria)
  }, [searchCriteria, workerInstance])

  return (
    <div className="App">
      <input type="text" value={searchCriteria} onChange={(e) => setSearchCriteria(e.target.value)} />
      {didSearch ? 'did search' : 'no search'}
      {searchResults.map((s, i) => <div key={i}><img src={`${process.env.REACT_APP_ASSETS_URL}/${s.photo}`} alt={s.text} /></div>)}
    </div>
  );
}

export default App;
