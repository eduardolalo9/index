/**
 * js/storage.js — v2.3 CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * Persistencia local con localStorage (offline-first).
 *
 * FIX BUG-9:
 *   saveToLocalStorage no incluía 3 campos críticos:
 *
 *   • auditoriaView — si el bartender recargaba durante un conteo,
 *     auditoriaView volvía a 'selection' y la pantalla de conteo
 *     desaparecía aunque el conteo estuviera activo.
 *
 *   • adjustmentsPending — cola offline de ajustes de stock
 *     solicitados por usuarios sin conexión. Al recargar, la cola
 *     se vaciaba y los ajustes nunca llegaban al admin.
 *
 *   • ajustesPendientes — lista de ajustes pendientes del admin.
 *     Se reconstruye desde Firestore vía listener, pero guardarla
 *     evita el parpadeo de "sin ajustes" durante la reconexión.
 *
 * Correcciones anteriores (v2.2):
 *   • smartAutoSave() — solo guarda si el estado cambió (hash)
 *   • searchTerm — se perdía en cada recarga
 * ══════════════════════════════════════════════════════════════
 */

import { state } from './state.js';

const STORAGE_KEY = 'inventarioApp_data';

export function saveToLocalStorage() {
  try {
    const dataToSave = {
      products:                  state.products,
      cart:                      state.cart,
      orders:                    state.orders,
      inventories:               state.inventories,
      activeTab:                 state.activeTab,
      selectedArea:              state.selectedArea,
      selectedGroup:             state.selectedGroup,
      searchTerm:                state.searchTerm,
      inventarioConteo:          state.inventarioConteo,
      auditoriaConteo:           state.auditoriaConteo,
      auditoriaStatus:           state.auditoriaStatus,
      auditoriaConteoPorUsuario: state.auditoriaConteoPorUsuario,
      // FIX BUG-9: campos que faltaban
      auditoriaView:             state.auditoriaView,
      auditoriaAreaActiva:       state.auditoriaAreaActiva,
      isAuditoriaMode:           state.isAuditoriaMode,
      adjustmentsPending:        state.adjustmentsPending,
      ajustesPendientes:         state.ajustesPendientes,
      // fin fix
      ajustes:                   state.ajustes,
      syncEnabled:               state.syncEnabled,
      _lastModified:             Date.now(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    localStorage.setItem('inventarioApp_lastModified', String(Date.now()));

    state._lastDataHash =
      JSON.stringify(state.products)        +
      JSON.stringify(state.orders)          +
      JSON.stringify(state.inventories)     +
      JSON.stringify(state.inventarioConteo);

  } catch (e) {
    console.error('[Storage] Error al guardar:', e);
  }
}

export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.info('[Storage] No hay datos guardados — estado inicial.');
      return;
    }

    const data = JSON.parse(raw);

    if (Array.isArray(data.products))          state.products                  = data.products;
    if (Array.isArray(data.cart))              state.cart                      = data.cart;
    if (Array.isArray(data.orders))            state.orders                    = data.orders;
    if (Array.isArray(data.inventories))       state.inventories               = data.inventories;
    if (data.activeTab)                        state.activeTab                 = data.activeTab;
    if (data.selectedArea)                     state.selectedArea              = data.selectedArea;
    if (data.selectedGroup)                    state.selectedGroup             = data.selectedGroup;
    if (data.searchTerm !== undefined)         state.searchTerm                = data.searchTerm;
    if (data.inventarioConteo)                 state.inventarioConteo          = data.inventarioConteo;
    if (data.auditoriaConteo)                  state.auditoriaConteo           = data.auditoriaConteo;
    if (data.auditoriaStatus)                  state.auditoriaStatus           = data.auditoriaStatus;
    if (data.auditoriaConteoPorUsuario)        state.auditoriaConteoPorUsuario = data.auditoriaConteoPorUsuario;
    if (data.ajustes)                          state.ajustes                   = data.ajustes;
    if (data.syncEnabled !== undefined)        state.syncEnabled               = data.syncEnabled;

    // FIX BUG-9: restaurar campos que antes no se guardaban
    if (data.auditoriaView)                    state.auditoriaView             = data.auditoriaView;
    if (data.auditoriaAreaActiva !== undefined) state.auditoriaAreaActiva      = data.auditoriaAreaActiva;
    if (data.isAuditoriaMode !== undefined)    state.isAuditoriaMode           = data.isAuditoriaMode;
    if (Array.isArray(data.adjustmentsPending)) state.adjustmentsPending       = data.adjustmentsPending;
    if (Array.isArray(data.ajustesPendientes))  state.ajustesPendientes        = data.ajustesPendientes;
    // fin fix

    // Toggle de sync desde clave independiente (prioridad)
    try {
      const syncFlag = localStorage.getItem('inventarioApp_syncEnabled');
      if (syncFlag !== null) state.syncEnabled = syncFlag === '1';
    } catch (_) {}

    state._lastDataHash =
      JSON.stringify(state.products)        +
      JSON.stringify(state.orders)          +
      JSON.stringify(state.inventories)     +
      JSON.stringify(state.inventarioConteo);

    console.info(`[Storage] ✓ ${state.products.length} productos cargados.`);

  } catch (e) {
    console.error('[Storage] Error al cargar:', e);
  }
}

export function smartAutoSave() {
  try {
    const currentHash =
      JSON.stringify(state.products)        +
      JSON.stringify(state.orders)          +
      JSON.stringify(state.inventories)     +
      JSON.stringify(state.inventarioConteo);

    if (currentHash === state._lastDataHash) {
      console.debug('[Storage] smartAutoSave — sin cambios.');
      return;
    }

    saveToLocalStorage();
    console.info('[Storage] smartAutoSave — guardado.');
  } catch (e) {
    console.error('[Storage] smartAutoSave — error:', e);
  }
}

export function clearLocalStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('inventarioApp_lastModified');
    localStorage.removeItem('inventarioApp_syncEnabled');
    console.info('[Storage] ✓ localStorage limpiado.');
  } catch (e) {
    console.error('[Storage] Error al limpiar:', e);
  }
}
