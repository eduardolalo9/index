/**
 * js/sync.js — v3.0 COMPLETO
 * ══════════════════════════════════════════════════════════════
 * Sincronización bidireccional en tiempo real con Firebase Firestore.
 * Versión reconstruida y completa.
 *
 * ─── EXPORTS PÚBLICOS ────────────────────────────────────────
 *   _setLastLocalWriteTs(ts)
 *   updateCloudSyncBadge(state)
 *   updateNetworkStatus()
 *   syncToCloud()
 *   toggleSync(forzarValor?)
 *   startRealtimeListeners()
 *   stopRealtimeListeners()
 *   isListening()
 *   txCloseZone(area)
 *   syncConteoAtomicoPorArea(area)
 *   syncConteoPorUsuarioToFirestore(area)
 *   resetConteoAtomicoEnFirestore()
 *   initUserLocksListener()          ← integrado desde sync-patch.js
 *
 * ─── ARQUITECTURA DE LISTENERS (10 onSnapshot activos) ───────
 *   [1]    inventarioApp/{DOC_ID}                  → doc principal
 *   [2-4]  inventarioApp/{DOC_ID}/stockAreas/{area} x3
 *   [5-7]  inventarioApp/{DOC_ID}/conteoAreas/{area} x3
 *   [8-10] inventarioApp/{DOC_ID}/conteoPorUsuario/{area} x3
 *
 * ─── GARANTÍAS TRANSACCIONALES ───────────────────────────────
 *   [T1] txCloseZone(area)          — cierre atómico dot-notation
 *   [T2] syncConteoAtomicoPorArea   — sin acumulación
 *   [T3] syncConteoPorUsuarioToFirestore — por userId con _version
 *   [T4] syncToCloud                — "completada wins"
 *   [T5] resetConteoAtomicoEnFirestore — batch + transaction
 *
 * ─── ANTI-BUCLE (dos capas) ──────────────────────────────────
 *   Capa 1 — metadata.hasPendingWrites
 *   Capa 2 — _lastLocalWriteTs / sessionStorage _areaTs:{key}
 * ══════════════════════════════════════════════════════════════
 */

import { state }                     from './state.js';
import { AREA_KEYS, MAX_CHUNK_SIZE } from './constants.js';
import { showNotification }          from './ui.js';
import { syncStockByAreaFromConteo } from './products.js';
import { applyUserLocksFromSnapshot } from './audit.js';
import { saveToLocalStorage }         from './storage.js';

// ─── Registro de listeners ────────────────────────────────────
const _activeListeners = new Map();

// ─── Anti-bucle: timestamp de la última escritura local ───────
let _lastLocalWriteTs = 0;

/**
 * Permite que handleFileImport() estampe el timestamp antes de syncToCloud,
 * de modo que el onSnapshot ignore el eco y no sobreescriba con datos viejos.
 */
export function _setLastLocalWriteTs(ts) {
    _lastLocalWriteTs = ts;
    console.debug('[Sync] _lastLocalWriteTs estampado:', ts);
}

// ─── Debounce de re-render ────────────────────────────────────
let _renderDebounceTimer = null;
const RENDER_DEBOUNCE_MS = 150;

function _scheduleRender() {
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = setTimeout(async () => {
        try {
            const { renderTab } = await import('./render.js');
            renderTab();
        } catch (e) {
            console.error('[Snapshot] Error en renderTab diferido:', e);
        }
    }, RENDER_DEBOUNCE_MS);
}

// ═════════════════════════════════════════════════════════════
//  ANTI-ECO — sessionStorage
// ═════════════════════════════════════════════════════════════

function _storeLocalAreaTs(key, ts) {
    try { sessionStorage.setItem('_areaTs:' + key, String(ts)); } catch (_) {}
}

function _getLocalAreaTs(key) {
    try { return parseInt(sessionStorage.getItem('_areaTs:' + key) || '0', 10); } catch (_) { return 0; }
}

/**
 * Devuelve true si el snapshot debe ignorarse (eco local).
 * Capa 1: hasPendingWrites → escritura local confirmada aún en cola
 * Capa 2: timestamp del snapshot ≤ timestamp del último write local
 */
function _shouldIgnoreSnapshot(snap, localTs = _lastLocalWriteTs) {
    if (snap.metadata?.hasPendingWrites) return true;
    const cloudTs = snap.data()?._lastModified || 0;
    return cloudTs > 0 && cloudTs <= localTs;
}

// ═════════════════════════════════════════════════════════════
//  HELPERS DE CHUNK
// ═════════════════════════════════════════════════════════════

async function _writeChunkedSubcollection(docRef, subcollName, dataArray) {
    const colRef      = docRef.collection(subcollName);
    const totalChunks = Math.max(1, Math.ceil(dataArray.length / MAX_CHUNK_SIZE));

    const writeBatch = window._db.batch();
    for (let i = 0; i < totalChunks; i++) {
        writeBatch.set(colRef.doc('chunk_' + i), {
            items:       dataArray.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
            chunkIndex:  i,
            totalChunks: totalChunks,
            _updatedAt:  Date.now(),
        });
    }
    await writeBatch.commit();

    // Eliminar chunks sobrantes de versiones anteriores
    const existingSnap = await colRef.get();
    const cleanBatch   = window._db.batch();
    let   hasStale     = false;
    existingSnap.docs.forEach(doc => {
        const idx = parseInt((doc.id.match(/chunk_(\d+)/) || [])[1] ?? '-1', 10);
        if (idx < 0 || idx >= totalChunks) {
            cleanBatch.delete(doc.ref);
            hasStale = true;
        }
    });
    if (hasStale) await cleanBatch.commit();
}

async function _readChunkedSubcollection(docRef, subcollName) {
    const colRef = docRef.collection(subcollName);
    const snap   = await colRef.orderBy('chunkIndex').get();
    const items  = [];
    snap.docs.forEach(doc => {
        const data = doc.data();
        if (Array.isArray(data.items)) items.push(...data.items);
    });
    return items;
}

// ═════════════════════════════════════════════════════════════
//  APLICADORES DE DATOS (onSnapshot → state)
// ═════════════════════════════════════════════════════════════

async function _applyMainDocData(data) {
    if (!data) return;

    // Productos: solo actualizar si el catálogo en la nube es más reciente
    if (Array.isArray(data.products) && data.products.length > 0) {
        state.products = data.products.map(p => ({
            ...p,
            stockByArea: p.stockByArea || { almacen: 0, barra1: 0, barra2: 0 },
        }));
        console.debug('[Snapshot][main] Productos actualizados:', state.products.length);
    }

    // Carrito
    if (Array.isArray(data.cart)) state.cart = data.cart;

    // Estado de auditoría
    if (data.auditoriaStatus && typeof data.auditoriaStatus === 'object') {
        // "completada wins" — no retroceder a 'pendiente' si ya estaba completada localmente
        AREA_KEYS.forEach(area => {
            if (data.auditoriaStatus[area]) {
                if (state.auditoriaStatus[area] !== 'completada') {
                    state.auditoriaStatus[area] = data.auditoriaStatus[area];
                }
            }
        });
    }

    // auditoriaConteo (conteo simple, no multiusuario)
    if (data.auditoriaConteo && typeof data.auditoriaConteo === 'object') {
        // Merge: no sobreescribir lo que ya tenemos localmente
        Object.keys(data.auditoriaConteo).forEach(productId => {
            const local = state.auditoriaConteo[productId];
            const cloud = data.auditoriaConteo[productId];
            if (!local) {
                state.auditoriaConteo[productId] = cloud;
            } else {
                // Por área: solo actualizar si no tenemos datos locales
                AREA_KEYS.forEach(area => {
                    if (!local[area] && cloud[area]) {
                        if (!state.auditoriaConteo[productId]) state.auditoriaConteo[productId] = {};
                        state.auditoriaConteo[productId][area] = cloud[area];
                    }
                });
            }
        });
    }

    // inventarioConteo
    if (data.inventarioConteo && typeof data.inventarioConteo === 'object') {
        Object.keys(data.inventarioConteo).forEach(productId => {
            if (!state.inventarioConteo[productId]) {
                state.inventarioConteo[productId] = data.inventarioConteo[productId];
            }
        });
    }

    // inventarios guardados (chunked subcollection)
    if (data._hasInventoriesChunks) {
        try {
            const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
            const items  = await _readChunkedSubcollection(docRef, 'inventoriesChunks');
            if (items.length > 0) state.inventories = items;
        } catch (_) {}
    }

    syncStockByAreaFromConteo();
}

function _applyStockAreaData(area, areaData) {
    if (!areaData) return;
    state.products.forEach(p => {
        const val = areaData[p.id];
        if (val === undefined || val === null) return;
        if (!p.stockByArea) p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
        if (!state.inventarioConteo[p.id]) state.inventarioConteo[p.id] = {};
        const n = typeof val === 'number' ? val : (typeof val === 'object' ? (val.enteras || 0) : 0);
        p.stockByArea[area] = n;
        state.inventarioConteo[p.id][area] = n;
    });
}

function _applyConteoAreaData(area, areaData) {
    if (!areaData) return;
    state.products.forEach(p => {
        const cloudEntry = areaData[p.id];
        if (!cloudEntry || typeof cloudEntry !== 'object') return;
        if (!state.auditoriaConteo[p.id]) state.auditoriaConteo[p.id] = {};
        if (!state.auditoriaConteo[p.id][area]) {
            state.auditoriaConteo[p.id][area] = { enteras: 0, abiertas: [] };
        }
        if (typeof cloudEntry.enteras === 'number') {
            state.auditoriaConteo[p.id][area].enteras = cloudEntry.enteras;
        }
        if (Array.isArray(cloudEntry.abiertas)) {
            state.auditoriaConteo[p.id][area].abiertas = cloudEntry.abiertas;
        }
        if (cloudEntry.alerta_conflicto) {
            state.auditoriaConteo[p.id][area]._conflictoAbiertas = cloudEntry.stock_abierto_alternativo;
        } else {
            delete state.auditoriaConteo[p.id]?.[area]?._conflictoAbiertas;
        }
    });
}

function _applyUserConteoData(area, areaData) {
    if (!areaData) return;
    const myId = state.auditCurrentUser?.userId;
    state.products.forEach(p => {
        const prodData = areaData[p.id];
        if (!prodData || typeof prodData !== 'object') return;
        if (!state.auditoriaConteoPorUsuario[p.id])       state.auditoriaConteoPorUsuario[p.id] = {};
        if (!state.auditoriaConteoPorUsuario[p.id][area]) state.auditoriaConteoPorUsuario[p.id][area] = {};
        Object.keys(prodData).forEach(uid => {
            if (uid === myId)        return; // no sobreescribir el propio conteo
            if (uid.startsWith('_')) return; // ignorar campos internos
            state.auditoriaConteoPorUsuario[p.id][area][uid] = prodData[uid];
        });
    });
}

async function _persistCloudUpdate(cloudTs) {
    const { saveToLocalStorage: save } = await import('./storage.js');
    state._lastDataHash =
        JSON.stringify(state.products)      +
        JSON.stringify(state.orders)        +
        JSON.stringify(state.inventories)   +
        JSON.stringify(state.inventarioConteo);
    state._cloudSyncPending = false;
    save();
    if (cloudTs) localStorage.setItem('inventarioApp_lastModified', String(cloudTs));
    state._lastCloudSync = Date.now();
}

// ═════════════════════════════════════════════════════════════
//  LISTENERS onSnapshot
// ═════════════════════════════════════════════════════════════

function _subscribeMainDoc() {
    if (!window._db) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    console.info('[Snapshot] Activando listener del doc principal…');

    const unsub = docRef.onSnapshot(
        { includeMetadataChanges: true },
        async snap => {
            try {
                if (!snap.exists) { await syncToCloud(); return; }
                if (_shouldIgnoreSnapshot(snap)) return;
                const data    = snap.data();
                const cloudTs = data._lastModified || 0;
                const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
                if (cloudTs <= localTs) return;
                console.info(`[Snapshot][main] Cambio recibido (Δts=${cloudTs - localTs}ms).`);
                await _applyMainDocData(data);
                await _persistCloudUpdate(cloudTs);
                updateCloudSyncBadge('listening');
                _scheduleRender();
            } catch (err) {
                console.error('[Snapshot][main] Error:', err);
                updateCloudSyncBadge('error');
            }
        },
        err => {
            console.error('[Snapshot][main] Error en listener:', err);
            updateCloudSyncBadge('error');
        }
    );
    _activeListeners.set('main', unsub);
}

function _subscribeStockAreas() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('stockAreas');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener stockAreas/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(area))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    _storeLocalAreaTs(area, cloudTs);
                    _applyStockAreaData(area, areaData);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][stockArea:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][stockArea:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`stockArea:${area}`, unsub);
    }
}

function _subscribeConteoAreas() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener conteoAreas/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(`conteo:${area}`))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    _storeLocalAreaTs(`conteo:${area}`, cloudTs);
                    _applyConteoAreaData(area, areaData);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][conteoArea:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][conteoArea:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`conteoArea:${area}`, unsub);
    }
}

function _subscribeConteoPorUsuario() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener conteoPorUsuario/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(`user:${area}`))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    _storeLocalAreaTs(`user:${area}`, cloudTs);
                    _applyUserConteoData(area, areaData);
                    // Procesar bloqueos de usuario (_userLocks)
                    if (areaData._userLocks && typeof areaData._userLocks === 'object') {
                        applyUserLocksFromSnapshot(area, areaData);
                        saveToLocalStorage();
                    }
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][userConteo:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][userConteo:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`userConteo:${area}`, unsub);
    }
}

// ═════════════════════════════════════════════════════════════
//  CICLO DE VIDA DE LISTENERS
// ═════════════════════════════════════════════════════════════

export function startRealtimeListeners() {
    if (!window._db) {
        console.warn('[Snapshot] Firebase no disponible — listeners no iniciados.');
        return;
    }

    if (_activeListeners.size > 0) {
        console.info('[Snapshot] Reiniciando listeners…');
        stopRealtimeListeners();
    }

    const role    = state.userRole;
    const isAdmin = (role === 'admin' || role === null);

    if (isAdmin) {
        console.info('[Snapshot] ══ Iniciando listeners (rol: admin) ══');
        _subscribeMainDoc();
        _subscribeStockAreas();
        _subscribeConteoAreas();
        _subscribeConteoPorUsuario();

        import('./notificaciones.js').then(m => {
            const unsub = m.suscribirNotificaciones();
            if (unsub) _activeListeners.set('notificaciones', unsub);
        }).catch(e => console.warn('[Snapshot] Error notificaciones:', e));

        import('./ajustes.js').then(m => {
            const unsub = m.suscribirAjustesAdmin();
            if (unsub) _activeListeners.set('ajustes', unsub);
        }).catch(e => console.warn('[Snapshot] Error ajustes:', e));

        import('./reportes.js').then(m => {
            const unsub = m.suscribirReportesPublicados();
            if (unsub) _activeListeners.set('reportes', unsub);
        }).catch(e => console.warn('[Snapshot] Error reportes:', e));

    } else {
        console.info('[Snapshot] ══ Iniciando listeners (rol: user) ══');
        _subscribeMainDoc();
        _subscribeStockAreas();

        import('./notificaciones.js').then(m => {
            const unsub = m.suscribirNotificaciones();
            if (unsub) _activeListeners.set('notificaciones', unsub);
        }).catch(e => console.warn('[Snapshot] Error notificaciones:', e));

        import('./reportes.js').then(m => {
            const unsub = m.suscribirReportesPublicados();
            if (unsub) _activeListeners.set('reportes', unsub);
        }).catch(e => console.warn('[Snapshot] Error reportes:', e));
    }

    updateCloudSyncBadge('listening');
    console.info(`[Snapshot] ✓ ${_activeListeners.size} listeners activos (rol: ${role ?? 'dev-admin'}).`);
}

export function stopRealtimeListeners() {
    if (_activeListeners.size === 0) return;
    console.info(`[Snapshot] Deteniendo ${_activeListeners.size} listeners…`);
    _activeListeners.forEach((unsub, key) => {
        try { unsub(); console.debug(`[Snapshot] "${key}" detenido.`); }
        catch (e) { console.warn(`[Snapshot] Error al detener "${key}":`, e); }
    });
    _activeListeners.clear();
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = null;
    // Limpiar anti-eco en sessionStorage
    try {
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k?.startsWith('_areaTs:')) toRemove.push(k);
        }
        toRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
    updateCloudSyncBadge('none');
    console.info('[Snapshot] ✓ Todos los listeners detenidos.');
}

export function isListening() {
    return _activeListeners.size > 0;
}

// ═════════════════════════════════════════════════════════════
//  TOGGLE DE SINCRONIZACIÓN
// ═════════════════════════════════════════════════════════════

export async function toggleSync(forzarValor) {
    const nuevo = forzarValor !== undefined ? forzarValor : !state.syncEnabled;
    state.syncEnabled = nuevo;
    try { localStorage.setItem('inventarioApp_syncEnabled', nuevo ? '1' : '0'); } catch (_) {}

    if (nuevo) {
        showNotification('☁️ Sincronización activada');
        updateCloudSyncBadge('syncing');
        if (window._db && navigator.onLine) {
            syncToCloud().catch(e => console.warn('[toggleSync] syncToCloud falló:', e));
            import('./ajustes.js')
                .then(m => m.subirAjustesPendientes())
                .catch(() => {});
        }
    } else {
        showNotification('📴 Sincronización pausada — datos guardados localmente');
        updateCloudSyncBadge('pending');
    }

    // Actualizar UI del toggle en Historia
    try {
        const { renderTab } = await import('./render.js');
        renderTab();
    } catch (_) {}
}

window.toggleSync = toggleSync;
window.syncToCloud = undefined; // se asigna abajo

// ═════════════════════════════════════════════════════════════
//  ESTADO DE RED Y BADGE
// ═════════════════════════════════════════════════════════════

export function updateNetworkStatus() {
    const online = navigator.onLine;
    const badge  = document.getElementById('cloudSyncBadge');
    const dot    = document.getElementById('syncDot');

    if (dot) {
        dot.setAttribute('data-state', online ? (window._db ? 'synced' : 'none') : 'offline');
        dot.title = online ? (window._db ? 'Conectado a Firebase' : 'Sin Firebase') : 'Sin conexión';
    }

    if (!online) {
        if (badge) {
            badge.textContent = '📴 Sin conexión';
            badge.style.color = 'var(--amber, #f59e0b)';
        }
    } else {
        if (!window._db) {
            if (badge) {
                badge.textContent = '⚠️ Sin Firebase';
                badge.style.color = 'var(--amber, #f59e0b)';
            }
        }
    }

    // Si volvemos online y hay pendientes, sincronizar
    if (online && window._db && state.syncEnabled && state._cloudSyncPending && !state._syncInProgress) {
        setTimeout(() => {
            syncToCloud().catch(e => console.warn('[Network] Sync al reconectar falló:', e));
        }, 1000);
    }
}

const BADGE_STYLES = {
    none:      { text: '☁️ Sin Firebase',    color: '#8b8ca8', bg: 'rgba(80,81,106,0.12)', border: 'rgba(80,81,106,0.4)' },
    listening: { text: '☁️ Conectado',       color: '#30d158', bg: 'rgba(48,209,88,0.10)', border: 'rgba(48,209,88,0.28)' },
    syncing:   { text: '⏫ Sincronizando…',   color: '#0a84ff', bg: 'rgba(10,132,255,0.10)', border: 'rgba(10,132,255,0.28)' },
    synced:    { text: '✓ Sincronizado',      color: '#30d158', bg: 'rgba(48,209,88,0.10)', border: 'rgba(48,209,88,0.28)' },
    pending:   { text: '⏸ Sync pausado',     color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.28)' },
    error:     { text: '⚠️ Error de sync',   color: '#ff453a', bg: 'rgba(255,69,58,0.10)', border: 'rgba(255,69,58,0.28)' },
    offline:   { text: '📴 Sin conexión',     color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.28)' },
};

export function updateCloudSyncBadge(syncState) {
    const badge = document.getElementById('cloudSyncBadge');
    if (!badge) return;
    const s = BADGE_STYLES[syncState] || BADGE_STYLES.none;
    badge.textContent         = s.text;
    badge.style.color         = s.color;
    badge.style.background    = s.bg;
    badge.style.borderColor   = s.border;
    badge.style.border        = `1px solid ${s.border}`;

    const dot = document.getElementById('syncDot');
    if (dot) {
        dot.setAttribute('data-state', syncState);
        dot.title = s.text;
    }
}

// ═════════════════════════════════════════════════════════════
//  SYNC TO CLOUD — escritura principal a Firestore
// ═════════════════════════════════════════════════════════════

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 800;

export async function syncToCloud() {
    if (!window._db || !navigator.onLine) {
        state._cloudSyncPending = true;
        return;
    }
    if (!state.syncEnabled) {
        state._cloudSyncPending = true;
        return;
    }
    if (state._syncInProgress) {
        state._cloudSyncPending = true;
        return;
    }

    // Debounce para no saturar Firestore con escrituras rápidas
    clearTimeout(_syncDebounceTimer);
    return new Promise((resolve, reject) => {
        _syncDebounceTimer = setTimeout(async () => {
            try {
                await _doSyncToCloud();
                resolve();
            } catch (e) {
                reject(e);
            }
        }, SYNC_DEBOUNCE_MS);
    });
}

async function _doSyncToCloud() {
    if (state._syncInProgress) return;
    state._syncInProgress = true;
    updateCloudSyncBadge('syncing');

    try {
        const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
        const writeTs = Date.now();

        // Preparar payload del doc principal
        const docPayload = {
            products:         state.products,
            cart:             state.cart,
            inventarioConteo: state.inventarioConteo,
            auditoriaConteo:  state.auditoriaConteo,
            _lastModified:    writeTs,
        };

        // Usar runTransaction para escritura atómica + "completada wins"
        await window._db.runTransaction(async (t) => {
            const snap = await t.get(docRef);

            // Merge auditoriaStatus: "completada wins"
            const mergedStatus = { ...state.auditoriaStatus };
            if (snap.exists) {
                const cloudData = snap.data();
                AREA_KEYS.forEach(area => {
                    if (cloudData.auditoriaStatus?.[area] === 'completada') {
                        mergedStatus[area] = 'completada';
                    }
                });
            }
            docPayload.auditoriaStatus = mergedStatus;

            t.set(docRef, docPayload, { merge: true });
        });

        // Efectos secundarios FUERA del callback de transacción (Firestore puede reintentar)
        _lastLocalWriteTs = writeTs;
        localStorage.setItem('inventarioApp_lastModified', String(writeTs));

        // Escribir stockAreas como subcollecciones
        const stockBatch = window._db.batch();
        for (const area of AREA_KEYS) {
            const areaRef  = docRef.collection('stockAreas').doc(area);
            const areaData = { _lastModified: writeTs };
            state.products.forEach(p => {
                areaData[p.id] = p.stockByArea?.[area] ?? 0;
            });
            stockBatch.set(areaRef, areaData, { merge: true });
        }
        await stockBatch.commit();
        AREA_KEYS.forEach(area => _storeLocalAreaTs(area, writeTs));

        // Chunked subcollections para pedidos e inventarios
        if (state.orders.length > 0) {
            await _writeChunkedSubcollection(docRef, 'ordersChunks', state.orders);
        }
        if (state.inventories.length > 0) {
            await _writeChunkedSubcollection(docRef, 'inventoriesChunks', state.inventories);
        }

        // Actualizar estado
        state._cloudSyncPending = false;
        state._lastCloudSync    = Date.now();
        state._lastDataHash     =
            JSON.stringify(state.products)      +
            JSON.stringify(state.orders)        +
            JSON.stringify(state.inventories)   +
            JSON.stringify(state.inventarioConteo);

        updateCloudSyncBadge('synced');
        console.info('[Sync] ✓ Sincronizado a la nube —', new Date(writeTs).toLocaleTimeString('es-MX'));

    } catch (err) {
        state._cloudSyncPending = true;
        console.error('[Sync] Error en syncToCloud:', err.message);
        updateCloudSyncBadge('error');
        throw err;
    } finally {
        state._syncInProgress = false;
    }
}

window.syncToCloud = syncToCloud;

// ═════════════════════════════════════════════════════════════
//  TRANSACCIÓN: CERRAR ZONA (txCloseZone)
// ═════════════════════════════════════════════════════════════

/**
 * Cierra atómicamente una zona de auditoría usando dot-notation.
 * Solo actualiza el campo de la zona específica, sin tocar las demás.
 *
 * @param {string} area — 'almacen' | 'barra1' | 'barra2'
 * @returns {Promise<{ wasAlreadyClosed: boolean, mergedStatus: object }>}
 */
export async function txCloseZone(area) {
    if (!window._db) throw new Error('Firebase no disponible');

    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);

    let wasAlreadyClosed = false;
    let mergedStatus     = null;

    await window._db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        const data = snap.exists ? snap.data() : {};
        const currentStatus = data.auditoriaStatus?.[area];

        if (currentStatus === 'completada') {
            wasAlreadyClosed = true;
            mergedStatus     = data.auditoriaStatus;
            return; // Idempotente: ya estaba cerrada
        }

        // Usar dot-notation para solo actualizar este campo
        t.update(docRef, {
            [`auditoriaStatus.${area}`]: 'completada',
            _lastModified: Date.now(),
        });

        mergedStatus = {
            ...(data.auditoriaStatus || { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' }),
            [area]: 'completada',
        };
    });

    const writeTs = Date.now();
    _lastLocalWriteTs = writeTs;
    localStorage.setItem('inventarioApp_lastModified', String(writeTs));

    return { wasAlreadyClosed, mergedStatus };
}

// ═════════════════════════════════════════════════════════════
//  TRANSACCIÓN: SYNC CONTEO ATÓMICO POR ÁREA
// ═════════════════════════════════════════════════════════════

/**
 * Escribe el conteo de auditoría (auditoriaConteo) de un área a Firestore.
 * Atomic: usa runTransaction para evitar acumulación.
 *
 * @param {string} area
 */
export async function syncConteoAtomicoPorArea(area) {
    if (!window._db) return;

    const docRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas')
        .doc(area);

    const writeTs  = Date.now();
    const payload  = { _lastModified: writeTs };

    state.products.forEach(p => {
        const conteo = state.auditoriaConteo[p.id]?.[area];
        if (!conteo) return;
        payload[p.id] = {
            enteras:  conteo.enteras  || 0,
            abiertas: Array.isArray(conteo.abiertas) ? conteo.abiertas : [],
        };
    });

    await window._db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        // Detectar conflictos de botellas abiertas
        if (snap.exists) {
            const cloudData = snap.data();
            state.products.forEach(p => {
                if (!payload[p.id]) return;
                const cloudEntry = cloudData[p.id];
                if (cloudEntry && Array.isArray(cloudEntry.abiertas) && cloudEntry.abiertas.length > 0) {
                    if (payload[p.id].abiertas.length > 0) {
                        const sumCloud = cloudEntry.abiertas.reduce((s, v) => s + v, 0);
                        const sumLocal = payload[p.id].abiertas.reduce((s, v) => s + v, 0);
                        if (Math.abs(sumCloud - sumLocal) > 0.5) {
                            payload[p.id].alerta_conflicto = true;
                            payload[p.id].stock_abierto_alternativo = sumCloud;
                        }
                    }
                }
            });
        }
        t.set(docRef, payload, { merge: true });
    });

    _storeLocalAreaTs(`conteo:${area}`, writeTs);
    console.info(`[Sync] syncConteoAtomicoPorArea(${area}) ✓`);
}

// ═════════════════════════════════════════════════════════════
//  TRANSACCIÓN: SYNC CONTEO POR USUARIO A FIRESTORE
// ═════════════════════════════════════════════════════════════

/**
 * Escribe los conteos del usuario actual (auditoriaConteoPorUsuario) a Firestore.
 * Solo escribe los datos del userId actual — no sobreescribe los demás.
 *
 * @param {string} area
 */
export async function syncConteoPorUsuarioToFirestore(area) {
    if (!window._db) return;

    const userId   = state.auditCurrentUser?.userId || state.currentUser?.uid || 'anon';
    const userName = state.auditCurrentUser?.userName || state.currentUser?.email || 'Usuario';

    const docRef  = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario')
        .doc(area);

    const writeTs = Date.now();
    const updatePayload = { _lastModified: writeTs };

    state.products.forEach(p => {
        const conteoUsuario = state.auditoriaConteoPorUsuario[p.id]?.[area]?.[userId];
        if (!conteoUsuario) return;
        updatePayload[`${p.id}.${userId}`] = {
            enteras:  conteoUsuario.enteras  || 0,
            abiertas: Array.isArray(conteoUsuario.abiertas) ? conteoUsuario.abiertas : [],
            userId,
            userName,
            ts: writeTs,
        };
    });

    await window._db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        if (!snap.exists) {
            // Primera escritura: crear el documento completo
            const initData = { _lastModified: writeTs };
            state.products.forEach(p => {
                const cu = state.auditoriaConteoPorUsuario[p.id]?.[area]?.[userId];
                if (!cu) return;
                initData[p.id] = {
                    [userId]: {
                        enteras:  cu.enteras  || 0,
                        abiertas: Array.isArray(cu.abiertas) ? cu.abiertas : [],
                        userId, userName, ts: writeTs,
                    }
                };
            });
            t.set(docRef, initData);
        } else {
            // Update: solo el userId actual
            t.update(docRef, updatePayload);
        }
    });

    _storeLocalAreaTs(`user:${area}`, writeTs);
    console.info(`[Sync] syncConteoPorUsuarioToFirestore(${area}) ✓ — usuario: ${userName}`);
}

// ═════════════════════════════════════════════════════════════
//  RESET ATÓMICO DE CONTEOS (iniciarNuevoCiclo)
// ═════════════════════════════════════════════════════════════

/**
 * Resetea en Firestore todos los conteos de auditoría.
 * Batch para conteoAreas y conteoPorUsuario.
 * Transaction para el doc principal (auditoriaStatus y auditoriaConteo).
 */
export async function resetConteoAtomicoEnFirestore() {
    if (!window._db) throw new Error('Firebase no disponible');

    const docRef   = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const writeTs  = Date.now();

    // 1. Batch: limpiar subcollecciones de conteo
    const batch = window._db.batch();
    for (const area of AREA_KEYS) {
        const conteoRef = docRef.collection('conteoAreas').doc(area);
        const userRef   = docRef.collection('conteoPorUsuario').doc(area);
        batch.set(conteoRef, { _lastModified: writeTs, _reset: true }, { merge: false });
        batch.set(userRef,   { _lastModified: writeTs, _reset: true, _userLocks: {} }, { merge: false });
    }
    await batch.commit();

    // 2. Transaction: resetear estado en doc principal
    await window._db.runTransaction(async (t) => {
        t.update(docRef, {
            auditoriaStatus:  {
                almacen: 'pendiente',
                barra1:  'pendiente',
                barra2:  'pendiente',
            },
            auditoriaConteo:  {},
            inventarioConteo: {},
            _lastModified:    writeTs,
        });
    });

    _lastLocalWriteTs = writeTs;
    localStorage.setItem('inventarioApp_lastModified', String(writeTs));
    AREA_KEYS.forEach(area => {
        _storeLocalAreaTs(`conteo:${area}`, writeTs);
        _storeLocalAreaTs(`user:${area}`,   writeTs);
    });

    console.info('[Sync] ✓ Reset atómico completado en Firestore.');
}

// ═════════════════════════════════════════════════════════════
//  INIT USER LOCKS LISTENER (integrado desde sync-patch.js)
// ═════════════════════════════════════════════════════════════

/**
 * Inicia un listener adicional sobre _userLocks en conteoPorUsuario.
 * Procesado también dentro de _subscribeConteoPorUsuario,
 * pero este listener garantiza que el admin reciba los bloqueos
 * incluso cuando sus propios listeners no están activos.
 *
 * Llamar después de startRealtimeListeners() y autenticación.
 */
export function initUserLocksListener() {
    if (!window._db || !window.FIRESTORE_DOC_ID) {
        setTimeout(initUserLocksListener, 2000);
        return;
    }
    // Los bloqueos ya se procesan en _subscribeConteoPorUsuario,
    // que está activo para admin. Este listener es redundancia
    // para asegurar que el estado se propague correctamente.
    // No duplicamos el listener si ya hay uno activo.
    if (_activeListeners.has('userLocks_almacen')) {
        console.debug('[SyncPatch] Listener de bloqueos ya activo.');
        return;
    }

    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario');

    AREA_KEYS.forEach(area => {
        // Solo iniciar si no hay ya un listener de conteoPorUsuario para este área
        if (_activeListeners.has(`userConteo:${area}`)) return;

        const unsub = baseRef.doc(area).onSnapshot(snap => {
            if (!snap.exists) return;
            const data = snap.data();
            if (!data || !data._userLocks) return;
            applyUserLocksFromSnapshot(area, data);
            saveToLocalStorage();
            import('./render.js').then(m => m.renderTab()).catch(() => {});
        }, err => {
            console.warn(`[SyncPatch] Error listener userLocks/${area}:`, err?.message);
        });
        _activeListeners.set(`userLocks_${area}`, unsub);
    });

    console.info('[SyncPatch] ✓ Listener de bloqueos de usuario activo.');
}
