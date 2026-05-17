import sharp from 'sharp'
import { readFileSync } from 'fs'

const svg = readFileSync('./public/logo.svg')

await Promise.all([
  sharp(svg).resize(192, 192).png().toFile('./public/icon-192.png'),
  sharp(svg).resize(512, 512).png().toFile('./public/icon-512.png'),
  sharp(svg).resize(180, 180).png().toFile('./public/apple-touch-icon.png'),
])

console.log('Icons generated: icon-192.png, icon-512.png, apple-touch-icon.png')
