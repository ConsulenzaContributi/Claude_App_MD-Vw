import {
  cloneElement,
  isValidElement,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'

type Theme = 'paper' | 'ink'
type OutlineDensity = 'full' | 'compact'
type DropTarget = 'library' | 'reader' | null

type LibraryFile = {
  path: string
  name: string
  content: string
}

type Heading = {
  id: string
  level: number
  text: string
}

type Preferences = {
  fontScale: number
  lineHeight: number
  focusOnOpen: boolean
}

declare const __APP_VERSION__: string

declare global {
  interface Window {
    mdVw?: {
      openMarkdownFile: () => Promise<LibraryFile | null>
      openMarkdownFolder: () => Promise<LibraryFile[]>
      onFilesOpened: (listener: (files: LibraryFile[]) => void) => () => void
    }
  }
}

const DEFAULT_PREFERENCES: Preferences = {
  fontScale: 1,
  lineHeight: 1.72,
  focusOnOpen: false,
}

const CHANGELOG = [
  {
    version: '0.5.1',
    title: 'Refactor editoriale',
    notes: [
      'Impaginazione a colonna unica e rimozione dei controlli grafici superflui.',
      'Ricerca con highlight, conteggio risultati e navigazione tra match.',
      'Focus mode, preferenze, changelog interno e outline compattabile.',
      'Tray macOS aggiornato con monogramma testuale MD piu affidabile.',
    ],
  },
  {
    version: '0.1.0',
    title: 'Base macOS reader',
    notes: [
      'Shell Electron con apertura file e cartelle Markdown.',
      'Menu bar, associazione file e libreria iniziale.',
    ],
  },
]

const sampleMarkdown = `# md Vw

Un lettore Markdown per macOS disegnato per leggere file veri, non pagine web improvvisate.

## Filosofia

md Vw punta a una lettura calma, strutturata e professionale:

- un solo foglio centrale
- una libreria ordinata
- outline chiaro e cliccabile
- controlli minimi ma utili

## Flusso

1. Apri un file o una cartella di note.
2. Il documento attivo finisce in cima alla libreria.
3. Cerca nel testo, salta tra i match e usa l'outline per muoverti.

## Perfezionamento

Questa versione introduce un impianto piu sobrio, piu leggibile e piu vicino a un vero reader editoriale.
`

const DEFAULT_LIBRARY: LibraryFile[] = [
  {
    path: 'demo://mdvw-intro',
    name: 'md Vw Intro.md',
    content: sampleMarkdown,
  },
]

const STORAGE_KEYS = {
  library: 'mdvw-library',
  activePath: 'mdvw-active-path',
  theme: 'mdvw-theme',
  preferences: 'mdvw-preferences',
  focusMode: 'mdvw-focus-mode',
  outlineDensity: 'mdvw-outline-density',
} as const

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

function getExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index).toLowerCase()
}

function isMarkdownName(name: string) {
  return ['.md', '.markdown', '.mdown'].includes(getExtension(name))
}

function extractHeadings(markdown: string): Heading[] {
  return markdown
    .split('\n')
    .map((line) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line.trim())
      if (!match) {
        return null
      }

      const text = match[2].trim()

      return {
        id: slugify(text),
        level: match[1].length,
        text,
      }
    })
    .filter((heading): heading is Heading => Boolean(heading))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countMatches(content: string, query: string) {
  if (!query.trim()) {
    return 0
  }

  const matches = content.match(new RegExp(escapeRegExp(query.trim()), 'gi'))
  return matches?.length ?? 0
}

function mergeLibraryFiles(
  currentLibrary: LibraryFile[],
  incomingFiles: LibraryFile[],
  preferredPath?: string,
) {
  const incomingByPath = new Map(incomingFiles.map((file) => [file.path, file]))
  const orderedIncoming = [...incomingFiles]
  const remaining = currentLibrary.filter((entry) => !incomingByPath.has(entry.path))
  const library = [...orderedIncoming, ...remaining].slice(0, 24)
  const activePath =
    preferredPath && library.some((entry) => entry.path === preferredPath)
      ? preferredPath
      : orderedIncoming[0]?.path ?? library[0]?.path ?? ''

  return { library, activePath }
}

function readStoredLibrary() {
  if (typeof window === 'undefined') {
    return DEFAULT_LIBRARY
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.library)
    if (!stored) {
      return DEFAULT_LIBRARY
    }

    const parsed = JSON.parse(stored) as LibraryFile[]
    if (!Array.isArray(parsed) || !parsed.length) {
      return DEFAULT_LIBRARY
    }

    return parsed.filter(
      (entry) =>
        typeof entry?.path === 'string' &&
        typeof entry?.name === 'string' &&
        typeof entry?.content === 'string',
    )
  } catch {
    return DEFAULT_LIBRARY
  }
}

function readStoredPreferences() {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.preferences)
    if (!stored) {
      return DEFAULT_PREFERENCES
    }

    const parsed = JSON.parse(stored) as Partial<Preferences>
    return {
      fontScale:
        typeof parsed.fontScale === 'number' && parsed.fontScale >= 0.9 && parsed.fontScale <= 1.25
          ? parsed.fontScale
          : DEFAULT_PREFERENCES.fontScale,
      lineHeight:
        typeof parsed.lineHeight === 'number' && parsed.lineHeight >= 1.55 && parsed.lineHeight <= 1.95
          ? parsed.lineHeight
          : DEFAULT_PREFERENCES.lineHeight,
      focusOnOpen:
        typeof parsed.focusOnOpen === 'boolean'
          ? parsed.focusOnOpen
          : DEFAULT_PREFERENCES.focusOnOpen,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function getPlainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return ''
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getPlainText).join('')
  }

  if (isValidElement(node)) {
    const childProp = (node.props as { children?: ReactNode }).children
    return getPlainText(childProp)
  }

  return ''
}

function highlightText(text: string, query: string, keyPrefix: string) {
  if (!query.trim()) {
    return text
  }

  const matches = [...text.matchAll(new RegExp(escapeRegExp(query.trim()), 'gi'))]
  if (!matches.length) {
    return text
  }

  const parts: ReactNode[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    const start = match.index ?? 0
    const end = start + match[0].length

    if (start > cursor) {
      parts.push(text.slice(cursor, start))
    }

    parts.push(
      <mark key={`${keyPrefix}-${index}`} data-search-match="true">
        {text.slice(start, end)}
      </mark>,
    )

    cursor = end
  })

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts
}

function highlightNode(node: ReactNode, query: string, keyPrefix = 'node'): ReactNode {
  if (!query.trim()) {
    return node
  }

  if (node == null || typeof node === 'boolean') {
    return node
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return highlightText(String(node), query, keyPrefix)
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => highlightNode(child, query, `${keyPrefix}-${index}`))
  }

  if (isValidElement(node)) {
    const childProp = (node.props as { children?: ReactNode }).children
    return cloneElement(node as ReactElement<{ children?: ReactNode }>, {
      children: highlightNode(childProp, query, `${keyPrefix}-child`),
    })
  }

  return node
}

async function loadMarkdownFilesFromFileList(fileList: FileList | File[]) {
  const files = Array.from(fileList).filter((file) => isMarkdownName(file.name))
  const loaded = await Promise.all(
    files.map(async (file) => ({
      path: file.webkitRelativePath || `dropped://${file.name}`,
      name: file.name,
      content: await file.text(),
    })),
  )

  return loaded
}

function App() {
  const initialLibrary = readStoredLibrary()
  const initialActivePath =
    typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_KEYS.activePath) ?? initialLibrary[0]?.path ?? ''
      : initialLibrary[0]?.path ?? ''
  const initialTheme =
    typeof window !== 'undefined' &&
    (localStorage.getItem(STORAGE_KEYS.theme) === 'paper' ||
      localStorage.getItem(STORAGE_KEYS.theme) === 'ink')
      ? (localStorage.getItem(STORAGE_KEYS.theme) as Theme)
      : 'paper'
  const initialFocusMode =
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.focusMode) === 'true' : false
  const initialOutlineDensity =
    typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEYS.outlineDensity) === 'compact'
      ? 'compact'
      : 'full'

  const [library, setLibrary] = useState<LibraryFile[]>(initialLibrary)
  const [activePath, setActivePath] = useState(initialActivePath)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [preferences, setPreferences] = useState<Preferences>(readStoredPreferences())
  const [focusMode, setFocusMode] = useState(initialFocusMode)
  const [outlineDensity, setOutlineDensity] = useState<OutlineDensity>(initialOutlineDensity)
  const [search, setSearch] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const [activeHeadingId, setActiveHeadingId] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [showPreferences, setShowPreferences] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const [scrollProgress, setScrollProgress] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const readerStageRef = useRef<HTMLDivElement>(null)
  const readerBodyRef = useRef<HTMLDivElement>(null)
  const focusOnOpenRef = useRef(preferences.focusOnOpen)

  const activeFile = useMemo(
    () => library.find((entry) => entry.path === activePath) ?? library[0],
    [activePath, library],
  )

  const headings = useMemo(() => extractHeadings(activeFile?.content ?? ''), [activeFile?.content])

  const visibleHeadings = useMemo(
    () => (outlineDensity === 'compact' ? headings.filter((heading) => heading.level <= 2) : headings),
    [headings, outlineDensity],
  )

  const stats = useMemo(() => {
    const content = activeFile?.content ?? ''
    const words = content.trim().split(/\s+/).filter(Boolean).length

    return {
      words,
      characters: content.length,
      minutes: Math.max(1, Math.round(words / 220)),
      headings: headings.length,
      matches: countMatches(content, search),
    }
  }, [activeFile?.content, headings.length, search])

  const canNavigateMatches = matchCount > 0

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEYS.theme, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(preferences))
  }, [preferences])

  useEffect(() => {
    focusOnOpenRef.current = preferences.focusOnOpen
  }, [preferences.focusOnOpen])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.focusMode, String(focusMode))
  }, [focusMode])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.outlineDensity, outlineDensity)
  }, [outlineDensity])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify(library.slice(0, 24)))
    localStorage.setItem(STORAGE_KEYS.activePath, activePath)
  }, [activePath, library])

  useEffect(() => {
    const node = folderInputRef.current
    if (!node) {
      return
    }

    node.setAttribute('webkitdirectory', '')
    node.setAttribute('directory', '')
  }, [])

  useEffect(() => {
    if (!statusMessage) {
      return
    }

    const timeout = window.setTimeout(() => setStatusMessage(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [statusMessage])

  useEffect(() => {
    const marks = readerBodyRef.current?.querySelectorAll<HTMLElement>('mark[data-search-match="true"]') ?? []
    setMatchCount(marks.length)
    setActiveMatchIndex(marks.length ? 0 : 0)
  }, [activeFile?.content, search])

  useEffect(() => {
    const marks = readerBodyRef.current?.querySelectorAll<HTMLElement>('mark[data-search-match="true"]') ?? []
    marks.forEach((mark, index) => {
      mark.classList.toggle('active-search-match', index === activeMatchIndex)
    })

    if (!marks.length) {
      return
    }

    const safeIndex = Math.min(activeMatchIndex, marks.length - 1)
    marks[safeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeMatchIndex, matchCount])

  useEffect(() => {
    const root = readerStageRef.current
    if (!root) {
      return
    }

    const handleScroll = () => {
      const maxScroll = root.scrollHeight - root.clientHeight
      if (maxScroll <= 0) {
        setScrollProgress(0)
        return
      }

      setScrollProgress(Math.min(100, Math.max(0, (root.scrollTop / maxScroll) * 100)))
    }

    handleScroll()
    root.addEventListener('scroll', handleScroll, { passive: true })
    return () => root.removeEventListener('scroll', handleScroll)
  }, [activeFile?.content, focusMode, preferences.fontScale, preferences.lineHeight, search])

  useEffect(() => {
    const root = readerStageRef.current
    if (!root) {
      return
    }

    const headingsInDom = root.querySelectorAll<HTMLElement>('[data-heading-id]')
    if (!headingsInDom.length) {
      setActiveHeadingId('')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)

        if (visible[0]) {
          setActiveHeadingId(visible[0].target.getAttribute('data-heading-id') ?? '')
        }
      },
      {
        root,
        rootMargin: '-18% 0px -68% 0px',
        threshold: [0, 0.2, 1],
      },
    )

    headingsInDom.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [activeFile?.content, search, focusMode])

  function applyLoadedFiles(files: LibraryFile[], successMessage: string) {
    const markdownFiles = files.filter((file) => isMarkdownName(file.name))
    if (!markdownFiles.length) {
      setStatusMessage('Nessun file Markdown valido trovato.')
      return
    }

    let nextActivePath = ''
    setLibrary((current) => {
      const nextState = mergeLibraryFiles(current, markdownFiles, markdownFiles[0].path)
      nextActivePath = nextState.activePath
      return nextState.library
    })
    setActivePath(nextActivePath || markdownFiles[0].path)
    setSearch('')
    setStatusMessage(successMessage)

    if (preferences.focusOnOpen) {
      setFocusMode(true)
    }
  }

  useEffect(() => {
    const removeListener = window.mdVw?.onFilesOpened((files) => {
      if (!files.length) {
        return
      }

      const markdownFiles = files.filter((file) => isMarkdownName(file.name))
      if (!markdownFiles.length) {
        setStatusMessage('Nessun file Markdown valido trovato.')
        return
      }

      let nextActivePath = ''
      setLibrary((current) => {
        const nextState = mergeLibraryFiles(current, markdownFiles, markdownFiles[0].path)
        nextActivePath = nextState.activePath
        return nextState.library
      })
      setActivePath(nextActivePath || markdownFiles[0].path)
      setSearch('')
      setStatusMessage(`${markdownFiles.length} file caricati`)

      if (focusOnOpenRef.current) {
        setFocusMode(true)
      }
    })

    return () => {
      removeListener?.()
    }
  }, [])

  async function openFile() {
    if (window.mdVw) {
      const file = await window.mdVw.openMarkdownFile()
      if (!file) {
        return
      }

      applyLoadedFiles([file], `${file.name} caricato`)
      return
    }

    fileInputRef.current?.click()
  }

  async function openFolder() {
    if (window.mdVw) {
      const files = await window.mdVw.openMarkdownFolder()
      if (!files.length) {
        return
      }

      applyLoadedFiles(files, `${files.length} file caricati dalla cartella`)
      return
    }

    folderInputRef.current?.click()
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files?.length) {
      return
    }

    const loaded = await loadMarkdownFilesFromFileList(files)
    applyLoadedFiles(loaded, `${loaded[0]?.name ?? 'File'} caricato`)
    event.target.value = ''
  }

  async function handleFolderInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files?.length) {
      return
    }

    const loaded = await loadMarkdownFilesFromFileList(files)
    applyLoadedFiles(loaded, `${loaded.length} file caricati dalla cartella`)
    event.target.value = ''
  }

  async function handleDrop(event: DragEvent<HTMLElement>, target: DropTarget) {
    event.preventDefault()
    setDropTarget(null)

    const files = event.dataTransfer.files
    if (!files.length) {
      setStatusMessage('Il drop non contiene file leggibili.')
      return
    }

    const loaded = await loadMarkdownFilesFromFileList(files)
    if (!loaded.length) {
      setStatusMessage('Trascina uno o piu file Markdown.')
      return
    }

    const message =
      target === 'reader'
        ? `${loaded[0]?.name ?? 'Documento'} aperto nel reader`
        : `${loaded.length} file aggiunti alla libreria`
    applyLoadedFiles(loaded, message)
  }

  function handleDragOver(event: DragEvent<HTMLElement>, target: DropTarget) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropTarget(target)
  }

  function handleDragLeave() {
    setDropTarget(null)
  }

  function jumpToHeading(id: string) {
    const target = readerStageRef.current?.querySelector<HTMLElement>(`[data-heading-id="${id}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function moveToMatch(direction: 1 | -1) {
    if (!canNavigateMatches) {
      return
    }

    setActiveMatchIndex((current) => {
      const next = current + direction
      if (next < 0) {
        return matchCount - 1
      }

      if (next >= matchCount) {
        return 0
      }

      return next
    })
  }

  const readerStyle = {
    '--reader-font-scale': preferences.fontScale,
    '--reader-line-height': preferences.lineHeight,
    '--reader-progress': `${scrollProgress}%`,
  } as CSSProperties

  return (
    <main className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".md,.markdown,.mdown,text/markdown,text/plain"
        onChange={handleFileInputChange}
      />
      <input ref={folderInputRef} hidden type="file" multiple onChange={handleFolderInputChange} />

      {!focusMode ? (
        <aside
          className={`library-panel ${dropTarget === 'library' ? 'drop-active' : ''}`}
          onDragOver={(event) => handleDragOver(event, 'library')}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDrop(event, 'library')}
        >
          <div className="panel-header">
            <p className="eyebrow">Libreria</p>
            <div className="brand-row">
              <h1>md Vw</h1>
              <button type="button" className="version-badge" onClick={() => setShowChangelog(true)}>
                v{__APP_VERSION__}
              </button>
            </div>
            <p className="panel-copy">Reader Markdown per macOS con resa editoriale, ricerca e struttura.</p>
          </div>

          <div className="library-actions">
            <button type="button" onClick={openFile}>
              Apri file
            </button>
            <button type="button" className="secondary" onClick={openFolder}>
              Apri cartella
            </button>
          </div>

          <div className="sidebar-tools">
            <button type="button" className="ghost-button" onClick={() => setShowPreferences(true)}>
              Preferenze
            </button>
            <button type="button" className="ghost-button" onClick={() => setFocusMode(true)}>
              Focus mode
            </button>
          </div>

          <div className="file-section-header">
            <span>Recenti</span>
            <span>{library.length}</span>
          </div>

          <div className="file-list">
            {library.map((file, index) => (
              <button
                key={file.path}
                type="button"
                className={`file-card ${file.path === activeFile?.path ? 'active' : ''}`}
                onClick={() => setActivePath(file.path)}
              >
                <span className="file-order">{String(index + 1).padStart(2, '0')}</span>
                <span className="file-name">{file.name}</span>
                <span className="file-path">{file.path}</span>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      <section
        className={`reader-shell ${dropTarget === 'reader' ? 'drop-active' : ''}`}
        style={readerStyle}
        onDragOver={(event) => handleDragOver(event, 'reader')}
        onDragLeave={handleDragLeave}
        onDrop={(event) => void handleDrop(event, 'reader')}
      >
        <div className="reader-progress-bar" aria-hidden="true" />

        <header className="reader-toolbar">
          <div className="toolbar-main">
            <div className="document-meta-block">
              <span className="document-name">{activeFile?.name}</span>
              <span className="document-meta">
                {stats.minutes} min lettura · {stats.words} parole
              </span>
            </div>

            <div className="toolbar-actions">
              <label className="search-field">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cerca nel testo"
                />
              </label>

              <div className="search-nav">
                <span className="search-count">
                  {matchCount ? `${activeMatchIndex + 1}/${matchCount}` : '0'}
                </span>
                <button type="button" className="icon-button" onClick={() => moveToMatch(-1)} disabled={!canNavigateMatches}>
                  ↑
                </button>
                <button type="button" className="icon-button" onClick={() => moveToMatch(1)} disabled={!canNavigateMatches}>
                  ↓
                </button>
              </div>

              <button
                type="button"
                className="theme-toggle"
                onClick={() => setTheme(theme === 'paper' ? 'ink' : 'paper')}
              >
                {theme === 'paper' ? 'Tema Inchiostro' : 'Tema Carta'}
              </button>

              <button type="button" className="ghost-button" onClick={() => setFocusMode((current) => !current)}>
                {focusMode ? 'Esci focus' : 'Focus'}
              </button>

              <button type="button" className="ghost-button" onClick={() => setShowPreferences(true)}>
                Preferenze
              </button>
            </div>
          </div>
        </header>

        <div ref={readerStageRef} className="reader-stage">
          <article ref={readerBodyRef} className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => {
                  const text = getPlainText(children)
                  const id = slugify(text)
                  return (
                    <h1 id={id} data-heading-id={id}>
                      {highlightNode(children, search, id)}
                    </h1>
                  )
                },
                h2: ({ children }) => {
                  const text = getPlainText(children)
                  const id = slugify(text)
                  return (
                    <h2 id={id} data-heading-id={id}>
                      {highlightNode(children, search, id)}
                    </h2>
                  )
                },
                h3: ({ children }) => {
                  const text = getPlainText(children)
                  const id = slugify(text)
                  return (
                    <h3 id={id} data-heading-id={id}>
                      {highlightNode(children, search, id)}
                    </h3>
                  )
                },
                h4: ({ children }) => {
                  const text = getPlainText(children)
                  const id = slugify(text)
                  return (
                    <h4 id={id} data-heading-id={id}>
                      {highlightNode(children, search, id)}
                    </h4>
                  )
                },
                p: ({ children }) => <p>{highlightNode(children, search)}</p>,
                li: ({ children }) => <li>{highlightNode(children, search)}</li>,
                td: ({ children }) => <td>{highlightNode(children, search)}</td>,
                th: ({ children }) => <th>{highlightNode(children, search)}</th>,
                blockquote: ({ children }) => <blockquote>{highlightNode(children, search)}</blockquote>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {highlightNode(children, search)}
                  </a>
                ),
              }}
            >
              {activeFile?.content ?? ''}
            </ReactMarkdown>
          </article>
        </div>

        <footer className="reader-footer">
          <span>{stats.characters} caratteri</span>
          <span>{stats.headings} sezioni</span>
          <span>{stats.matches} match</span>
          <span>{Math.round(scrollProgress)}% letto</span>
        </footer>
      </section>

      {!focusMode ? (
        <aside className="outline-panel">
          <div className="panel-header">
            <p className="eyebrow">Struttura</p>
            <div className="outline-header-row">
              <h2>Outline</h2>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setOutlineDensity((current) => (current === 'full' ? 'compact' : 'full'))}
              >
                {outlineDensity === 'full' ? 'Compatta' : 'Estesa'}
              </button>
            </div>
          </div>

          <div className="stats-grid">
            <div>
              <strong>{stats.headings}</strong>
              <span>sezioni</span>
            </div>
            <div>
              <strong>{stats.minutes}</strong>
              <span>minuti</span>
            </div>
          </div>

          <nav className="outline-list">
            {visibleHeadings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                className={`outline-link outline-level-${heading.level} ${
                  activeHeadingId === heading.id ? 'active' : ''
                }`}
                onClick={() => jumpToHeading(heading.id)}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        </aside>
      ) : null}

      {statusMessage ? <div className="status-toast">{statusMessage}</div> : null}

      {showPreferences ? (
        <div className="modal-backdrop" onClick={() => setShowPreferences(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Impostazioni</p>
                <h3>Preferenze di lettura</h3>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowPreferences(false)}>
                ×
              </button>
            </div>

            <div className="preferences-grid">
              <label className="preference-row">
                <span>Scala tipografica</span>
                <input
                  type="range"
                  min="0.9"
                  max="1.2"
                  step="0.05"
                  value={preferences.fontScale}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      fontScale: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="preference-row">
                <span>Interlinea</span>
                <input
                  type="range"
                  min="1.55"
                  max="1.95"
                  step="0.05"
                  value={preferences.lineHeight}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      lineHeight: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="preference-checkbox">
                <input
                  type="checkbox"
                  checked={preferences.focusOnOpen}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      focusOnOpen: event.target.checked,
                    }))
                  }
                />
                <span>Attiva automaticamente il focus mode quando apri un nuovo file</span>
              </label>
            </div>
          </section>
        </div>
      ) : null}

      {showChangelog ? (
        <div className="modal-backdrop" onClick={() => setShowChangelog(false)}>
          <section className="modal-card modal-card--changelog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Versioni</p>
                <h3>Changelog md Vw</h3>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowChangelog(false)}>
                ×
              </button>
            </div>

            <div className="changelog-list">
              {CHANGELOG.map((release) => (
                <section key={release.version} className="changelog-item">
                  <div className="changelog-heading">
                    <strong>v{release.version}</strong>
                    <span>{release.title}</span>
                  </div>

                  <ul>
                    {release.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
