import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Masonry from '@mui/lab/Masonry';
import Meme from './Meme'
import './App.css';

// eslint-disable-next-line import/no-webpack-loader-syntax
const Worker = require('workerize-loader!./search.worker')

const useContainerWidth = (ref: React.RefObject<HTMLElement | null>) => {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
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
  const containerWidth = useContainerWidth(ref);
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
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const workerRpcIdRef = useRef(0)

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
      case 'setSuggestions': setSuggestions(params); break
      default: console.error('unexpected message type: ' + t); break
    }
  }

  useEffect(() => {
    if (!workerInstance) return
    workerInstance.addEventListener('message', processMessage)
    return () => workerInstance.removeEventListener('message', processMessage)
  }, [workerInstance])

  const invokeWorker = useCallback((method: 'init' | 'search' | 'autoSuggest', ...params: any[]) => {
    if (!workerInstance) return
    if (typeof workerInstance[method] === 'function') {
      workerInstance[method](...params)
      return
    }
    // Fallback for dev/HMR cases where workerize proxies are missing.
    workerRpcIdRef.current += 1
    workerInstance.postMessage({
      type: 'RPC',
      id: workerRpcIdRef.current,
      method,
      params
    })
  }, [workerInstance])

  useEffect(() => {
    if (loading || !workerInstance) return
    setLoading(true)

    invokeWorker('init')
  }, [loading, workerInstance, invokeWorker])

  useEffect(() => {
    invokeWorker('search', searchCriteria)
    invokeWorker('autoSuggest', searchCriteria)
  }, [searchCriteria, workerInstance, invokeWorker])

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
  const memesToShow = didSearch ? searchResults : defaultResults

  const [loadingMessage, setLoadingMessage] = useState('Cargando memes...')

  useEffect(() => {
    if (ready) return
    const messages = [
      'Buscando la gracia...',
      'Entrenando a las neuronas...',
      'Inyectando humor...',
      'Calculando el nivel de "xd"...',
      'Esperá un toque...',
      'Preparando los momazos...',
      'Desempolvando el teclado...',
      'Buscando el meme perfecto...'
    ]
    const interval = setInterval(() => {
      setLoadingMessage(messages[Math.floor(Math.random() * messages.length)])
    }, 1500)
    return () => clearInterval(interval)
  }, [ready])

  return (
    <div className="App" ref={ref}>
      <header>
        <label>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input autoFocus={true} type="text" placeholder={"Buscar memes..."} value={searchCriteria} ref={searchInputRef}
            autoComplete="off"
            onChange={(event) => {
              const value = event.target.value
              setSearchCriteria(value)
              setShowSuggestions(true)
              setActiveIndex(-1)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (!showSuggestions || suggestions.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex(i => i < suggestions.length - 1 ? i + 1 : 0)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex(i => i > 0 ? i - 1 : suggestions.length - 1)
              } else if (e.key === 'Enter' && activeIndex >= 0) {
                e.preventDefault()
                setSearchCriteria(suggestions[activeIndex])
                setShowSuggestions(false)
                setActiveIndex(-1)
              } else if (e.key === 'Escape') {
                setShowSuggestions(false)
                setActiveIndex(-1)
              }
            }}
          />
          <button onClick={() => {
            setSearchCriteria('')
            searchInputRef.current?.focus()
          }} aria-label="Clear" id="clear" className={searchCriteria === '' ? 'hidden' : ''}></button>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((s, i) => (
                <li key={s} className={i === activeIndex ? 'active' : ''}
                  onMouseDown={() => {
                    setSearchCriteria(s)
                    setShowSuggestions(false)
                    setActiveIndex(-1)
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                >{s}</li>
              ))}
            </ul>
          )}
        </label>
      </header>
      {!ready && (
        <div className="loading">
          <div className="spinner" />
          <p>{loadingMessage}</p>
        </div>
      )}
      {containerWidth > 0 && (
        <Masonry columns={columns} spacing={2}>
          {memesToShow.map(({ height, width, photo, reactions, chat_id, message_id }) => (
            <div key={photo} className="meme-card" style={{ height: containerWidth * height / (columns * width) }}>
              {chat_id && message_id ? (
                <a href={`https://t.me/c/${chat_id.replace('-100', '')}/${message_id}`} target="_blank" rel="noreferrer">
                  <MemeImage photo={photo} />
                </a>
              ) : (
                <MemeImage photo={photo} />
              )}
              {reactions && reactions.length > 0 && (
                <div className="reactions" aria-label="Reactions">
                  {reactions.map(({ emoji, count }) => (
                    <span key={emoji} className="reaction-pill">
                      <span>{emoji}</span>
                      <span>{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Masonry>
      )}
    </div>
  );
}

export default App;
