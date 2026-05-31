'use client'
import { useEffect, useRef, useState } from 'react'

// Minimal structural types for the Web Speech API (not in lib.dom defaults).
interface SpeechRecognitionResultItem { transcript: string }
interface SpeechRecognitionResult { 0: SpeechRecognitionResultItem; isFinal: boolean }
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number;[i: number]: SpeechRecognitionResult }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// Wraps the browser Web Speech API. `supported` is false when the constructor is
// missing (incl. SSR), so callers can hide the mic entirely. `start(onText)`
// streams recognised text (interim + final) to the callback; any error or `end`
// stops listening silently so the text box stays usable.
export function useVoiceInput() {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setSupported(getCtor() !== null)
    return () => { try { recRef.current?.stop() } catch { /* noop */ } }
  }, [])

  function start(onText: (text: string) => void) {
    const Ctor = getCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-GB'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      onText(text)
    }
    rec.onerror = () => { setListening(false) }
    rec.onend = () => { setListening(false) }
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { setListening(false) }
  }

  function stop() {
    try { recRef.current?.stop() } catch { /* noop */ }
    setListening(false)
  }

  return { supported, listening, start, stop }
}
