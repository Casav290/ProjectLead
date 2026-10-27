import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { I18nProvider, initI18n } from './i18n'
import './index.css'

// La langue de départ se charge avant le premier rendu : jamais une clé brute ni une autre langue à l'écran.
initI18n().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
))
