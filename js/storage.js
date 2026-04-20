/**
 * js/storage.js — v2.4
 * ══════════════════════════════════════════════════════════════
 * Persistencia local con localStorage (offline-first).
 *
 * NUEVO v2.4:
 *   conteoFinalizadoPorUsuario — incluido en save/load para
 *   persistir el estado de bloqueo por usuario entre recargas.
 *   Sin esto, al recargar la página se pierde quién ya finalizó
 *   y el admin no puede ver el estado correcto de los usuarios.
 * ══════════════════════════════════════════════════════════════
 */

import { state } from './state.js';

const STORAGE_KEY = 'inventarioApp_data';

export function saveToLocalStorage() {
  try {
    const dataToSave = {
      products:                    state.products,
      cart:                        state.cart,
      orders:                      state.orders,
      inventories:                 state.inventories,
      activeTab:                   state.activeTab,
      selectedArea:                state.selectedArea,
      selectedGroup:               state.selectedGroup,
      searchTerm:                  state.searchTerm,
      inventarioConteo:            state.inventarioConteo,
      auditoriaConteo:             state.auditoriaConteo,
      auditoriaStatus:             state.auditoriaStatus,
      auditoriaConteoPorUsuario:   state.auditoriaConteoPorUsuario,
      // FIX BUG-9
      auditoriaView:               state.auditoriaView,
      auditoriaAreaActiva:         state.auditoriaAreaActiva,
      isAuditoriaMode:             state.isAuditoriaMode,
      adjustmentsPending:          state.adjustmentsPending,
      ajustesPendientes:           state.ajustesPendientes,
      // NUEVO v2.4: bloqueo por usuario
      conteoFinalizadoPorUsuario:  state.conteoFinalizadoPorUsuario,
      // fin nuevo
      ajustes:                     state.ajustes,
      syncEnabled:                 state.syncEnabled,
      _lastModified:               Date.now(),
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

    // FIX BUG-9
    if (data.auditoriaView)                    state.auditoriaView             = data.auditoriaView;
    if (data.auditoriaAreaActiva !== undefined) state.auditoriaAreaActiva      = data.auditoriaAreaActiva;
    if (data.isAuditoriaMode !== undefined)    state.isAuditoriaMode           = data.isAuditoriaMode;
    if (Array.isArray(data.adjustmentsPending)) state.adjustmentsPending       = data.adjustmentsPending;
    if (Array.isArray(data.ajustesPendientes))  state.ajustesPendientes        = data.ajustesPendientes;

    // NUEVO v2.4: bloqueo por usuario
    if (data.conteoFinalizadoPorUsuario && typeof data.conteoFinalizadoPorUsuario === 'object') {
      state.conteoFinalizadoPorUsuario = {
        almacen: data.conteoFinalizadoPorUsuario.almacen || {},
        barra1:  data.conteoFinalizadoPorUsuario.barra1  || {},
        barra2:  data.conteoFinalizadoPorUsuario.barra2  || {},
      };
    }

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
