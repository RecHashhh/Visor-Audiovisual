import React from 'react'
import ReactDOM from 'react-dom/client'
import { EventType } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { BrowserRouter } from 'react-router-dom'
import { msalInstance } from './authConfig'
import App from './App'
import './index.css'

msalInstance.initialize().then(() => {
  // Procesar el redirect de Microsoft ANTES de cualquier cosa
  msalInstance.handleRedirectPromise()
    .then((response) => {
      // Si hay response, el usuario acaba de hacer login exitoso
      if (response && response.account) {
        msalInstance.setActiveAccount(response.account)
      } else {
        // Sin response — revisar si ya hay cuentas en cache
        const accounts = msalInstance.getAllAccounts()
        if (accounts.length > 0) {
          msalInstance.setActiveAccount(accounts[0])
        }
      }
    })
    .catch((error) => {
      console.error('Error procesando redirect de Microsoft:', error)
    })
    .finally(() => {
      // Renderizar la app SOLO después de que MSAL terminó de procesar
      msalInstance.addEventCallback((event) => {
        if (event.eventType === EventType.LOGIN_SUCCESS && event.payload?.account) {
          msalInstance.setActiveAccount(event.payload.account)
        }
        if (event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS && event.payload?.account) {
          msalInstance.setActiveAccount(event.payload.account)
        }
      })

      ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
          <MsalProvider instance={msalInstance}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </MsalProvider>
        </React.StrictMode>
      )
    })
})
