// src/authConfig.js
// Los valores vienen de window.__APP_CONFIG__ (inyectado en index.html por el workflow)
// o de variables de entorno Vite (desarrollo local con .env.local)
import { PublicClientApplication } from '@azure/msal-browser'

const cfg = (typeof window !== 'undefined' && window.__APP_CONFIG__) ? window.__APP_CONFIG__ : {}

const TENANT_ID = cfg.tenantId || import.meta.env.VITE_TENANT_ID || ''
const CLIENT_ID = cfg.clientId || import.meta.env.VITE_CLIENT_ID || ''
const SCOPE_URI  = cfg.scopeUri || import.meta.env.VITE_SCOPE_URI  || ''

if (!TENANT_ID || !CLIENT_ID) {
  console.error('[authConfig] TENANT_ID o CLIENT_ID no definidos.')
}

export const msalConfig = {
  auth: {
    clientId:              a4413b75-4069-48e0-b055-55dce319dfbc,
    authority:             `https://login.microsoftonline.com/${12f2a4b5-4935-464d-9dae-e0525d0c593f}`,
    redirectUri:           window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation:          'sessionStorage',
    storeAuthStateInCookie: false,
  },
}

export const loginRequest = {
  scopes: ['User.Read', ...(SCOPE_URI ? [SCOPE_URI] : [])],
}

export const apiRequest = {
  scopes: SCOPE_URI ? [SCOPE_URI] : ['User.Read'],
}

export const msalInstance = new PublicClientApplication(msalConfig)
