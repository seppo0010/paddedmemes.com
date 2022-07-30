import React, { useState, useEffect, useRef, useCallback } from 'react';
import Masonry from '@mui/lab/Masonry';
import Paper from '@mui/material/Paper';
import Meme from './Meme'
import './App.css';

// eslint-disable-next-line import/no-webpack-loader-syntax
const Worker = require('workerize-loader!./search.worker')

const useResize = (myRef: any) => {
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)

  const handleResize = useCallback(() => {
    setWidth(myRef?.current?.offsetWidth)
    setHeight(myRef?.current?.offsetHeight)
  }, [myRef])

  useEffect(() => {
    handleResize();
  }, [myRef, handleResize])

  useEffect(() => {
    window.addEventListener('load', handleResize)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('load', handleResize)
      window.removeEventListener('resize', handleResize)
    }
  }, [myRef, handleResize])

  return { width, height }
}

function App() {
  const ref = useRef<null | HTMLDivElement>(null);
  const containerWidth = useResize(ref).width;
  const [loading, setLoading] = useState(false)
  const [workerInstance, setWorkerInstance] = useState<any | null>(null)
  const [searchResults, setSearchResults] = useState<Meme[]>([])
  const [searchCriteria, setSearchCriteria] = useState('')
  const [didSearch, setDidSearch] = useState(false)
  const [ready, setReady] = useState(false)

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
      case 'setReady': setReady(params); break
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
    <div className="App" ref={ref}>
      <input type="text" value={searchCriteria} onChange={(e) => setSearchCriteria(e.target.value)} />
      {ready ? 'ready' : 'not ready'}
      {didSearch ? 'did search' : 'no search'}
      <Masonry columns={4} spacing={2}>
        {searchResults.map(({ height, width, photo, text }, i) => (
          <Paper key={i} sx={{ height: containerWidth * height / (4 * width) }}>
            <img src={`${process.env.REACT_APP_ASSETS_URL}/${photo}`} alt={text} style={{ width: '100%' }} />
          </Paper>
        ))}
      </Masonry>
    </div>
  );
}

export default App;
