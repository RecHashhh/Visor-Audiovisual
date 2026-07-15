// src/utils/favorites.jsx
// Estado compartido de favoritos del usuario: colecciones con nombre + el
// conjunto de rutas marcadas (para pintar el corazón en la galería). Se carga
// una vez y las mutaciones actualizan el estado local + el servidor.
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { api } from './api'

const Ctx = createContext(null)

export function FavoritesProvider({ children }) {
  const [collections, setCollections] = useState([])
  const [paths, setPaths] = useState(() => new Set())
  const [loaded, setLoaded] = useState(false)

  const apply = useCallback((data) => {
    setCollections(Array.isArray(data?.collections) ? data.collections : [])
    setPaths(new Set(Array.isArray(data?.paths) ? data.paths : []))
  }, [])

  const refresh = useCallback(() => {
    return api.getFavorites().then(apply).catch(() => {}).finally(() => setLoaded(true))
  }, [apply])

  useEffect(() => { refresh() }, [refresh])

  const createCollection = useCallback(async (name) => {
    const res = await api.createFavCollection(name)
    if (res?.collection) setCollections(cs => [...cs, res.collection])
    return res?.collection
  }, [])

  const renameCollection = useCallback(async (cid, name) => {
    const res = await api.renameFavCollection(cid, name)
    if (res?.collection) setCollections(cs => cs.map(c => (c.id === cid ? res.collection : c)))
  }, [])

  const deleteCollection = useCallback(async (cid) => {
    await api.deleteFavCollection(cid)
    setCollections(cs => cs.filter(c => c.id !== cid))
    // El servidor es la fuente de verdad para las rutas marcadas (corazones).
    refresh()
  }, [refresh])

  const addToCollection = useCallback(async (collectionId, item) => {
    const res = await api.addFavItem(collectionId, item)
    apply(res)
  }, [apply])

  const removeFromAll = useCallback(async (path) => {
    const res = await api.removeFavItem(path)
    apply(res)
  }, [apply])

  const removeFromCollection = useCallback(async (cid, path) => {
    const res = await api.removeFavItem(path, cid)
    apply(res)
  }, [apply])

  const value = useMemo(() => ({
    collections, paths, loaded, refresh,
    createCollection, renameCollection, deleteCollection, addToCollection, removeFromAll, removeFromCollection,
    isFav: (p) => paths.has(p),
  }), [collections, paths, loaded, refresh, createCollection, renameCollection, deleteCollection, addToCollection, removeFromAll, removeFromCollection])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFavorites() {
  return useContext(Ctx) || {
    collections: [], paths: new Set(), loaded: true, refresh: () => {},
    createCollection: async () => {}, renameCollection: async () => {}, deleteCollection: async () => {},
    addToCollection: async () => {}, removeFromAll: async () => {}, isFav: () => false,
  }
}
