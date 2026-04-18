import React from 'react'
import ReactDOM from 'react-dom/client'
import { EventType } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { BrowserRouter } from 'react-router-dom'
import { msalInstance } from './authConfig'
import App from './App'
import './index.css'

await msalInstance.initialize()

const redirectResult = await msalInstance.handleRedirectPromise()
if (redirectResult?.account) {
  msalInstance.setActiveAccount(redirectResult.account)
}

const accounts = msalInstance.getAllAccounts()
if (!msalInstance.getActiveAccount() && accounts.length > 0) {
  msalInstance.setActiveAccount(accounts[0])
}

msalInstance.addEventCallback((event) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload.account) {
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
