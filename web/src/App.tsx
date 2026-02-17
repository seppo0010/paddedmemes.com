import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Masonry from '@mui/lab/Masonry';
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

function MemeImage({ photo }: { photo: string }) {
  const [alt, setAlt] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          fetch(`${process.env.REACT_APP_ASSETS_URL}/${photo}.txt`)
            .then((res) => res.ok ? res.text() : '')
            .then(setAlt)
            .catch(() => {});
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(img);
    return () => observer.disconnect();
  }, [photo]);

  return <img ref={imgRef} src={`${process.env.REACT_APP_ASSETS_URL}/${photo}`} alt={alt} />;
}

function App() {
  const ref = useRef<null | HTMLDivElement>(null);
  const containerWidth = useResize(ref).width;
  const theme = useTheme();
  const sm = !useMediaQuery(theme.breakpoints.up('sm'));
  const md = !useMediaQuery(theme.breakpoints.up('md'));
  const [loading, setLoading] = useState(false)
  const [workerInstance, setWorkerInstance] = useState<any | null>(null)
  const [searchResults, setSearchResults] = useState<Meme[]>([])
  const [searchCriteria, setSearchCriteria] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('q') || ''
  })
  const [didSearch, setDidSearch] = useState(false)
  const [ready, setReady] = useState(false)
  const [defaultResults, setDefaultResults] = useState<Meme[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null)

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
      case 'setReady': setReady(true); break
      case 'setDefaultResults': setDefaultResults(params); break
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

  useEffect(() => {
    const url = new URL(window.location.href)
    if (searchCriteria) {
      url.searchParams.set('q', searchCriteria)
    } else {
      url.searchParams.delete('q')
    }
    window.history.replaceState(null, '', url)
  }, [searchCriteria])

  const columns = sm ? 1 : (md ? 2 : 4);

  return (
    <div className="App" ref={ref}>
      <header>
        <label>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input autoFocus={true} type="text" placeholder={"Buscar memes..."} value={searchCriteria} ref={searchInputRef} onChange={(event) => {
            const value = event.target.value
            setSearchCriteria(value)
          }} />
          <button onClick={() => {
            setSearchCriteria('')
            searchInputRef.current?.focus()
          }} aria-label="Clear" id="clear" className={searchCriteria === '' ? 'hidden' : ''}></button>
        </label>
      </header>
      {!ready && <div className="loading"><div className="spinner" /><p>Cargando memes...</p></div>}
      <Masonry columns={columns} spacing={2}>
        {(didSearch ? searchResults : defaultResults).map(({ height, width, photo }) => (
          <div key={photo} className="meme-card" style={{ height: containerWidth * height / (columns * width) }}>
            <MemeImage photo={photo} />
          </div>
        ))}
      </Masonry>
    </div>
  );
}

export default App;
