'use client'

import { useRef, useState, useEffect, useCallback } from 'react'

declare global {
  interface Window {
    pdfjsLib: any
    JSZip: any
  }
}

const CUIL_X0 = 325.19, CUIL_Y0 = 139.50
const CUIL_X1 = 376.60, CUIL_Y1 = 150.49
const TOLERANCE = 6

type ResultItem =
  | { status: 'ok'; original: string; newName: string }
  | { status: 'warn'; original: string }
  | { status: 'err'; original: string; error: string }

interface ProcessedFile {
  name: string
  blob: Blob | null
  newName: string | null
  status: 'ok' | 'warn' | 'err'
}

export default function Renombrador() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [prefijo, setPrefijo] = useState('haberes')
  const [mesAnio, setMesAnio] = useState('')
  const [preview, setPreview] = useState('MMAAAA_haberes_CUIL.pdf')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [results, setResults] = useState<ResultItem[] | null>(null)
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [libsReady, setLibsReady] = useState(false)

  useEffect(() => {
    function loadScript(src: string, onload: () => void) {
      const s = document.createElement('script')
      s.src = src
      s.onload = onload
      document.head.appendChild(s)
    }
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => {
        setLibsReady(true)
      })
    })
  }, [])

  useEffect(() => {
    const p = prefijo.trim() || 'prefijo'
    const m = mesAnio.trim() || 'MMAAAA'
    setPreview(`${m}_${p}_CUIL.pdf`)
  }, [prefijo, mesAnio])

  const addFiles = useCallback((newFiles: File[]) => {
    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...newFiles.filter(f => !existing.has(f.name))]
    })
  }, [])

  const removeFile = (name: string) =>
    setSelectedFiles(prev => prev.filter(f => f.name !== name))

  const canProcess =
    selectedFiles.length > 0 &&
    prefijo.trim() &&
    /^\d{6}$/.test(mesAnio.trim()) &&
    libsReady

  async function extractCUIL(arrayBuffer: ArrayBuffer): Promise<string> {
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const H = viewport.height
    const pdfY_bottom = H - CUIL_Y1
    const pdfY_top = H - CUIL_Y0
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items as any[]) {
      if (!item.str) continue
      const x = item.transform[4]
      const y = item.transform[5]
      if (
        x >= CUIL_X0 - TOLERANCE && x <= CUIL_X1 + TOLERANCE &&
        y >= pdfY_bottom - TOLERANCE && y <= pdfY_top + TOLERANCE
      ) {
        text += item.str
      }
    }
    return text.replace(/\D/g, '')
  }

  async function handleProcess() {
    setProcessing(true)
    setResults(null)
    setProgress(0)

    const usedNames: Record<string, number> = {}
    const resultItems: ResultItem[] = []
    const processed: ProcessedFile[] = []
    let exitosos = 0

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      setProgress(Math.round((i / selectedFiles.length) * 100))
      setProgressLabel(`Procesando ${i + 1} de ${selectedFiles.length}: ${file.name}`)

      try {
        const buf = await file.arrayBuffer()
        const cuil = await extractCUIL(buf.slice(0))

        if (cuil) {
          let newName = `${mesAnio}_${prefijo}_${cuil}.pdf`
          if (usedNames[newName]) {
            usedNames[newName]++
            newName = `${mesAnio}_${prefijo}_${cuil}_${usedNames[newName]}.pdf`
          } else {
            usedNames[newName] = 1
          }
          processed.push({ name: file.name, blob: new Blob([buf], { type: 'application/pdf' }), newName, status: 'ok' })
          resultItems.push({ status: 'ok', original: file.name, newName })
          exitosos++
        } else {
          processed.push({ name: file.name, blob: null, newName: null, status: 'warn' })
          resultItems.push({ status: 'warn', original: file.name })
        }
      } catch (e: any) {
        processed.push({ name: file.name, blob: null, newName: null, status: 'err' })
        resultItems.push({ status: 'err', original: file.name, error: e.message || 'Error desconocido' })
      }
    }

    setProgress(100)
    setProgressLabel('Listo.')
    setResults(resultItems)
    setProcessedFiles(processed)
    setProcessing(false)
  }

  async function handleDownload() {
    const zip = new window.JSZip()
    for (const f of processedFiles) {
      if (f.status === 'ok' && f.blob) zip.file(f.newName!, f.blob)
    }
    const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(content)
    a.download = `${mesAnio}_${prefijo}_recibos.zip`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exitosos = results?.filter(r => r.status === 'ok').length ?? 0
  const sinCuil = results ? results.length - exitosos : 0

  return (
    <div className="min-h-screen bg-[#f5f6f8] py-8 px-4">
      <div className="max-w-[640px] mx-auto flex flex-col gap-6">

        {/* Header */}
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-[#213478]">Renombrador de Recibos</h1>
          <p className="text-sm text-[#636271]">
            Extrae el CUIL de cada PDF y renombra los archivos automáticamente.
            Todo se procesa en tu computadora, sin subir nada a internet.
          </p>
        </header>

        {/* Paso 1 */}
        <div className="bg-white rounded-lg p-6 shadow-[−1px_4px_8px_0px_rgba(233,233,244,1)] flex flex-col gap-4">
          <span className="text-base font-semibold">1. Seleccioná los PDFs</span>
          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer flex flex-col items-center gap-2 transition-colors ${dragOver ? 'border-[#6f93eb] bg-[#eff2ff]' : 'border-[#c7cfe8] hover:border-[#6f93eb] hover:bg-[#eff2ff]'}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              addFiles([...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf')))
            }}
          >
            <svg width="32" height="32" fill="none" stroke="#6f93eb" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/>
            </svg>
            <p className="text-sm text-[#636271]"><strong className="text-[#213478] font-semibold">Arrastrá los archivos acá</strong> o hacé clic para seleccionar</p>
            <p className="text-sm text-[#636271]">Solo archivos .pdf</p>
          </div>
          <input ref={fileInputRef} type="file" multiple accept=".pdf" className="hidden"
            onChange={e => { addFiles([...e.target.files!]); e.target.value = '' }} />
          {selectedFiles.length > 0 && (
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {selectedFiles.map(f => (
                <div key={f.name} className="flex items-center gap-2 bg-[#eff2ff] rounded px-2.5 py-1.5 text-xs text-[#213478]">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
                  </svg>
                  <span className="flex-1 truncate">{f.name}</span>
                  <button onClick={() => removeFile(f.name)} className="text-[#636271] hover:text-red-500 text-base leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Paso 2 */}
        <div className="bg-white rounded-lg p-6 shadow-[−1px_4px_8px_0px_rgba(233,233,244,1)] flex flex-col gap-4">
          <span className="text-base font-semibold">2. Configurá el nombre</span>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#636271] uppercase tracking-wide">Prefijo</label>
              <input
                value={prefijo}
                onChange={e => setPrefijo(e.target.value)}
                placeholder="haberes"
                className="border-[1.5px] border-[#d1d5e8] rounded-lg px-3 py-2.5 text-sm text-[#303036] outline-none focus:border-[#6f93eb]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#636271] uppercase tracking-wide">Mes y año</label>
              <input
                value={mesAnio}
                onChange={e => setMesAnio(e.target.value)}
                placeholder="052024"
                maxLength={6}
                className="border-[1.5px] border-[#d1d5e8] rounded-lg px-3 py-2.5 text-sm text-[#303036] outline-none focus:border-[#6f93eb]"
              />
              <span className="text-xs text-[#636271]">Formato: MMAAAA — ej: 052024</span>
            </div>
          </div>
          <p className="text-xs text-[#636271]">Los archivos se van a llamar: <strong>{preview}</strong></p>
        </div>

        {/* Paso 3 */}
        <div className="bg-white rounded-lg p-6 shadow-[−1px_4px_8px_0px_rgba(233,233,244,1)] flex flex-col gap-4">
          <span className="text-base font-semibold">3. Procesá</span>
          <button
            onClick={handleProcess}
            disabled={!canProcess || processing}
            className="w-full bg-[#213478] text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            Renombrar PDFs
          </button>
          {(processing || progressLabel) && (
            <div className="flex flex-col gap-2">
              <div className="bg-[#eff2ff] rounded-full h-2 overflow-hidden">
                <div className="h-full bg-[#6f93eb] rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-[#636271]">{progressLabel}</span>
            </div>
          )}
        </div>

        {/* Resultados */}
        {results && (
          <div className="bg-white rounded-lg p-6 shadow-[−1px_4px_8px_0px_rgba(233,233,244,1)] flex flex-col gap-4">
            <span className="text-base font-semibold">Resultados</span>
            <div className="flex gap-4 flex-wrap">
              {[
                { num: exitosos, lbl: 'Renombrados', color: '#213478' },
                { num: sinCuil, lbl: 'Sin CUIL / Error', color: '#7a5c00' },
                { num: results.length, lbl: 'Total', color: '#213478' },
              ].map(s => (
                <div key={s.lbl} className="bg-[#eff2ff] rounded px-4 py-2 flex flex-col items-center">
                  <span className="text-2xl font-semibold" style={{ color: s.color }}>{s.num}</span>
                  <span className="text-[11px] text-[#636271] uppercase tracking-wide">{s.lbl}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {results.map((r, i) => (
                <div key={i} className={`flex items-start gap-2 text-[13px] px-2.5 py-2 rounded ${r.status === 'ok' ? 'bg-[#f0faf4] text-[#1a6b3e]' : r.status === 'warn' ? 'bg-[#fffbe6] text-[#7a5c00]' : 'bg-[#fff0f0] text-[#a01010]'}`}>
                  <span className="shrink-0 mt-px">{r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌'}</span>
                  <span className="font-semibold break-all">{r.original}</span>
                  {r.status === 'ok' && <><span className="shrink-0">→</span><span className="break-all">{r.newName}</span></>}
                  {r.status === 'warn' && <span>— No se detectó CUIL</span>}
                  {r.status === 'err' && <span>— Error: {r.error}</span>}
                </div>
              ))}
            </div>
            {exitosos > 0 && (
              <button
                onClick={handleDownload}
                className="w-full bg-[#6f93eb] text-white rounded-lg py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                ⬇ Descargar ZIP con los PDFs renombrados
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
