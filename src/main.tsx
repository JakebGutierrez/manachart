import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted title fonts (all SIL OFL) — replaces the Google Fonts <link> in
// index.html. Vite hashes the woff2 files into /assets/ (immutable-cached via
// vercel.json). Weights mirror the previous Google Fonts request exactly so
// titles render identically: the picker previews each family at 400, while
// rendered titles use 600 — which the browser nearest-matches to 700 for the
// families without a 600 face (Cinzel, Cormorant Garamond, Comic Neue).
// Each weight css carries all Unicode-range subsets, so the browser only
// downloads the subset a given title actually renders.
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/700.css'
import '@fontsource/uncial-antiqua/400.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/comic-neue/400.css'
import '@fontsource/comic-neue/700.css'
import './index.css'
import { SpeedInsights } from '@vercel/speed-insights/react'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <SpeedInsights />
    </ErrorBoundary>
  </StrictMode>,
)
