import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initZoom } from './tauri.js'
import './styles.css'

initZoom()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
