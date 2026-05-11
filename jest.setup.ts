import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'
import { webcrypto } from 'crypto'

// Polyfill Web Encoding API globals for jsdom test environment
globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder
globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder

// Polyfill Web Crypto API globals for jsdom test environment
// jsdom exposes crypto but without subtle — force-assign via defineProperty
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
})
