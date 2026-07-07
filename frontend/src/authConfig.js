// src/authConfig.js
import { PublicClientApplication } from '@azure/msal-browser'

// Valores inyectados en index.html por el CI/CD (window.__APP_CONFIG__)
// En desarrollo local: copiar .env.example a .env.local y completar
const cfg = (typeof window !== 'undefined' && window.__APP_CONFIG__) ? window.__APP_CONFIG__ : {}

const TENANT_ID = cfg.tenantId || import.meta.env.VITE_TENANT_ID  || '12f2a4b5-4935-464d-9dae-e0525d0c593f'
const CLIENT_ID = cfg.clientId || import.meta.env.VITE_CLIENT_ID  || 'a4413b75-4069-48e0-b055-55dce319dfbc'
const SCOPE_URI  = cfg.scopeUri || import.meta.env.VITE_SCOPE_URI  || 'api://a4413b75-4069-48e0-b055-55dce319dfbc/access_as_user'
if (!TENANT_ID || !CLIENT_ID) {
  console.error('[authConfig] TENANT_ID o CLIENT_ID no están definidos. Revisar secrets de GitHub.')
}

// Multi-tenant: "/organizations" permite iniciar sesión con cuentas de
// cualquier organización Microsoft (no personales). Qué organizaciones se
// admiten de verdad lo controla el backend (AAD_TENANT_IDS). Para volver a un
// solo tenant, define VITE_AUTHORITY o cfg.authority con el tenant ID.
const AUTHORITY = cfg.authority || import.meta.env.VITE_AUTHORITY
  || `https://login.microsoftonline.com/organizations`

export const msalConfig = {
  auth: {
    clientId:              CLIENT_ID,
    authority:             AUTHORITY,
    redirectUri:           window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,  // No redirigir a la URL original después del login
  },
  cache: {
    cacheLocation:          'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    allowNativeBroker: false,
  }
}

// Solo User.Read — no agregar scopes custom por ahora para evitar errores de consentimiento
export const loginRequest = {
  scopes: ['User.Read'],
}

// Para llamadas al backend — si no hay scope custom, usar solo User.Read
export const apiRequest = {
  scopes: (SCOPE_URI && SCOPE_URI !== 'User.Read') ? [SCOPE_URI] : ['User.Read'],
}

export const msalInstance = new PublicClientApplication(msalConfig)

// Cierre de sesión SOLO de la app: limpia la sesión local de MSAL y vuelve al
// login, SIN mandar al usuario al logout global de Microsoft (no lo obliga a
// cerrar su cuenta Microsoft 365). onRedirectNavigate:()=>false evita el
// redirect al endpoint de logout del proveedor.
export function logoutLocal() {
  const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || undefined
  return msalInstance
    .logoutRedirect({ account, onRedirectNavigate: () => false })
    .then(() => { window.location.assign('/') })
    .catch(() => { window.location.assign('/') })
}

