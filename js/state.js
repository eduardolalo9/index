/**
 * js/state.js — v2.4 DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 *
 * CORRECCIONES v2.4:
 *   • isAuditoriaMode — audit.js lo escribe en 4 funciones pero
 *     state.js no lo declaraba → loadFromLocalStorage no podía
 *     restaurarlo entre sesiones → modo auditoría inconsistente.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

  // ─── Catálogo de productos ───────────────────────────────────
  products: [],

  // ─── Carrito ─────────────────────────────────────────────────
  cart: [],

  // ─── Historial ───────────────────────────────────────────────
  orders:      [],
  inventories: [],

  // ─── Navegación / UI ─────────────────────────────────────────
  activeTab:     'inicio',
  selectedArea:  'almacen',
  selectedGroup: 'Todos',
  searchTerm:    '',

  // ─── Inventario operativo ────────────────────────────────────
  // { [productId]: { almacen: number, barra1: number, barra2: number } }
  inventarioConteo: {},

  // ─── Auditoría ───────────────────────────────────────────────
  // { [productId]: { [area]: { enteras: n, abiertas: [...oz] } } }
  auditoriaConteo: {},

  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // área activa en pantalla de conteo (v2.2)
  auditoriaAreaActiva: null,

  // sub-vista: 'selection' | 'counting' (v2.3)
  auditoriaView: 'selection',

  // FIX v2.4 — audit.js lo escribe en auditoriaEntrarArea/Finalizar/Volver/Resetear.
  // Sin declarar aquí, loadFromLocalStorage no puede restaurarlo y el modo auditoría
  // puede quedar inconsistente al recargar la página durante un conteo activo.
  isAuditoriaMode: false,

  // ─── Multi-usuario ────────────────────────────────────────────
  // { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // usuario actual de auditoría (v2.2)
  auditCurrentUser: null,

  // ─── Sesión Firebase (v2.2) ───────────────────────────────────
  currentUser:  null,
  userProfile:  null,

  // 'admin' | 'user' | null
  userRole: null,

  // ─── Sincronización ──────────────────────────────────────────
  syncEnabled:        true,
  _cloudSyncPending:  false,
  _syncInProgress:    false,
  _lastCloudSync:     0,
  _lastDataHash:      '',

  // ajustes pendientes offline (v2.2)
  adjustmentsPending: [],

  // ─── Notificaciones (v2.3) ────────────────────────────────────
  // NOTA: nombre en inglés — notificaciones.js usa state.notifications
  notifications:       [],
  notificationsUnread: 0,

  // ─── Ajustes del admin (v2.3) ────────────────────────────────
  ajustesPendientes: [],

  // configuración sincronizada
  ajustes: {},

  // ─── Reportes ────────────────────────────────────────────────
  reportesPublicados: [],
};
