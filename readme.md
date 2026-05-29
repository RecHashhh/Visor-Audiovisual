# 🚀 GUÍA DE DESPLIEGUE — VISOR AUDIOVISUAL
## Tiempo estimado: 30-40 minutos

---

## ✅ QUÉ NECESITAS TENER ANTES DE EMPEZAR

- [ ] Acceso a portal.azure.com con tu cuenta (ya tienes)
- [ ] Cuenta en github.com (gratis, crear si no tienes)
- [ ] Git instalado en tu PC: https://git-scm.com/download/win
- [ ] Node.js 20+ instalado: https://nodejs.org (LTS)
- [ ] Este ZIP descomprimido en una carpeta, ej: C:\proyectos\visor-audiovisual\

---

## PASO 1 — Registrar la app en Entra ID (8 min)

### 1.1 Ir a: portal.azure.com → busca "App registrations" → New registration

Llenar así:
```
Name:              visor-audiovisual
Supported types:   Accounts in this organizational directory only
Redirect URI:      Single-page application (SPA)
URI value:         http://localhost:5173
```
→ Click **Register**

### 1.2 En la página de la app recién creada, COPIAR estos dos valores:
```
Application (client) ID  →  📋 ESTE ES TU CLIENT_ID
Directory (tenant) ID    →  📋 ESTE ES TU TENANT_ID
```

### 1.3 Agregar permisos: Authentication → Add a platform (si no aparece SPA)
→ Verificar que http://localhost:5173 esté en Redirect URIs

### 1.4 (Opcional pero recomendado) Expose an API → Add a scope:
```
Scope name:    access_as_user
Who can consent: Admins and users
Display name:  Access Visor Audiovisual
→ Add scope
```
Copiar el URI completo: `api://CLIENT_ID/access_as_user` → SCOPE_URI

Si no quieres hacer esto, el SCOPE_URI puedes dejarlo vacío por ahora.

---

## PASO 2 — Configurar CORS en tu Blob Storage (3 min)

portal.azure.com → staudivisualproyectos → Resource sharing (CORS)

En la pestaña **Blob service**, agregar esta fila:
```
Allowed origins:  http://localhost:5173
Allowed methods:  GET, HEAD, OPTIONS
Allowed headers:  *
Exposed headers:  Content-Length, Content-Type
Max age:          3600
```
→ Save

(Después del paso 3, agregarás también la URL de producción)

---

## PASO 3 — Crear el Static Web App en Azure (5 min)

portal.azure.com → Static Web Apps → Create

```
Subscription:     la tuya
Resource group:   rg-audiovisual-construccion
Name:             visor-audiovisual
Plan type:        Free
Region:           East US 2
Source:           GitHub  ← conectar tu cuenta GitHub aquí
Organization:     tu-usuario-github
Repository:       visor-audiovisual  ← el repo que creas en paso 4
Branch:           main
Build preset:     Custom
App location:     /frontend
Api location:     /backend
Output location:  dist
```
→ Review + Create → **Create**

Cuando termine → ir al recurso → copiar el URL:
```
https://algo-aleatorio-xyz.azurestaticapps.net   → TU URL DE PRODUCCIÓN
```

### 3.1 Volver al Paso 1 → Entra ID → Authentication → agregar segunda Redirect URI:
```
https://algo-aleatorio-xyz.azurestaticapps.net
```
→ Save

### 3.2 Volver al Paso 2 → CORS → agregar segunda fila con la URL de producción

---

## PASO 4 — Subir el código a GitHub (5 min)

### 4.1 Crear repo en GitHub:
github.com → New repository → Name: `visor-audiovisual` → Private → Create

### 4.2 En tu PC, abrir terminal (PowerShell o CMD) en la carpeta del proyecto:
```powershell
cd C:\proyectos\visor-audiovisual

git init
git add .
git commit -m "feat: visor audiovisual inicial"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/visor-audiovisual.git
git push -u origin main
```

---

## PASO 5 — Configurar los Secrets en GitHub (5 min)

En tu repo de GitHub → Settings → Secrets and variables → Actions → New repository secret

Crear estos 4 secrets (nombre EXACTO, respetando mayúsculas):

### Secret 1:
```
Name:   AZURE_STATIC_WEB_APPS_API_TOKEN
Value:  (obtener en Azure → Static Web App → Manage deployment token → copiar)
```

### Secret 2:
```
Name:   VITE_TENANT_ID
Value:  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  ← el que copiaste en Paso 1.2
```

### Secret 3:
```
Name:   VITE_CLIENT_ID
Value:  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  ← el que copiaste en Paso 1.2
```

### Secret 4:
```
Name:   VITE_SCOPE_URI
Value:  api://CLIENT_ID/access_as_user  ← reemplaza CLIENT_ID con el valor real
        (si no hiciste Expose an API, deja este valor: User.Read)
```

---

## PASO 6 — Configurar variables del backend (3 min)

### Obtener la Connection String y Account Key del Storage:
portal.azure.com → staudivisualproyectos → Access keys → Show keys → copiar key1

### En Azure Portal → Static Web App → visor-audiovisual → Configuration → Add:

| Name | Value |
|------|-------|
| AZURE_STORAGE_CONNECTION_STRING | DefaultEndpointsProtocol=https;AccountName=staudivisualproyectos;AccountKey=TU_KEY;EndpointSuffix=core.windows.net |
| AZURE_STORAGE_ACCOUNT | staudivisualproyectos |
| AZURE_STORAGE_KEY | TU_ACCOUNT_KEY (solo la key, sin la connection string) |
| CONTAINER_NAME | audiovisual |
| TENANT_ID | tu-tenant-id |
| CLIENT_ID | tu-client-id |
| SHARE_SECRET | escribe-cualquier-texto-largo-aleatorio |

→ Save

---

## PASO 7 — Disparar el deploy (2 min)

```powershell
# Hacer cualquier cambio mínimo para disparar el CI/CD:
git commit --allow-empty -m "trigger deploy"
git push
```

→ Ir a github.com → tu repo → Actions → ver el deploy en curso (~3-4 min)
→ Cuando sea verde ✅, abrir la URL de producción

---

## PASO 8 — Probar (2 min)

```
✅ Abrir https://TU-APP.azurestaticapps.net
✅ Click "Iniciar sesión con Microsoft"
✅ Login con tu cuenta corporativa
✅ Aparecen los proyectos del Blob
✅ Navegar: proyecto → semanas → galería
```

---

## ❓ ERRORES COMUNES Y SOLUCIONES

### Error: "Specified tenant identifier 'undefined'"
→ Los secrets VITE_TENANT_ID / VITE_CLIENT_ID no se configuraron en GitHub
→ Verificar Paso 5, nombres exactos con mayúsculas

### Error: "AADSTS50011: The redirect URI does not match"
→ La URL de tu SWA no está registrada en Entra ID
→ Verificar Paso 3.1

### Error: "CORS error" al cargar imágenes
→ El origen de tu SWA no está en la regla CORS del Storage
→ Verificar Paso 3.2

### El deploy falla en GitHub Actions
→ Ir a Actions → click en el deploy fallido → expandir el paso que falla → leer el error
→ El más común: AZURE_STATIC_WEB_APPS_API_TOKEN incorrecto (Paso 5, Secret 1)

### Las funciones (API) no responden
→ Verificar que las variables del backend estén guardadas (Paso 6)
→ En Azure → Static Web App → Functions → verificar que aparezcan las funciones

---

## RESUMEN DE RECURSOS

```
Ya existía:   Storage Account staudivisualproyectos
Ya existía:   Container audiovisual  
Creado nuevo: App Registration visor-audiovisual (gratis)
Creado nuevo: Static Web App visor-audiovisual (plan Free = $0/mes)
```
