/**
 * js/state.js — v2.4 DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 * TODAS las propiedades que cualquier módulo lee/escribe deben
 * estar declaradas aquí — sin excepción.
 *
 * FIX BUG-7:
 *   isAuditoriaMode — audit.js lo escribe en 4 funciones:
 *     auditoriaEntrarArea()      → true
 *     auditoriaFinalizarConteo() → false
 *     auditoriaVolverSeleccion() → false
 *     auditoriaResetear()        → false
 *   Sin declarar aquí, loadFromLocalStorage no puede restaurarlo
 *   entre sesiones. Si el bartender recarga durante un conteo
 *   activo, el modo auditoría queda en false y el conteo se pierde.
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
  // { [productId]: { [area]: { enteras: n, abiertas: [oz, ...] } } }
  auditoriaConteo: {},

  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // Área activa en pantalla de conteo
  auditoriaAreaActiva: null,

  // Sub-vista: 'selection' | 'counting'
  auditoriaView: 'selection',

  // FIX BUG-7: flag de modo auditoría activo.
  // audit.js lo escribe en 4 funciones. Sin declarar aquí,
  // loadFromLocalStorage no puede restaurarlo al recargar,
  // y el conteo activo se pierde.
  isAuditoriaMode: false,

  // ─── Multi-usuario ────────────────────────────────────────────
  // { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // { userId, userName, role }
  auditCurrentUser: null,

  // ─── Sesión Firebase ─────────────────────────────────────────
  currentUser:  null,   // firebase.User | null
  userProfile:  null,   // { uid, email, displayName, role, ... }

  // 'admin' | 'user' | null
  userRole: null,

  // ─── Sincronización ──────────────────────────────────────────
  syncEnabled:        true,
  _cloudSyncPending:  false,
  _syncInProgress:    false,
  _lastCloudSync:     0,
  _lastDataHash:      '',

  // ─── Ajustes pendientes offline ──────────────────────────────
  // Cola de ajustes solicitados sin conexión — se suben al reconectar.
  adjustmentsPending: [],

  // ─── Notificaciones ──────────────────────────────────────────
  // NOTA: nombre en inglés — notificaciones.js usa state.notifications
  notifications:       [],
  notificationsUnread: 0,

  // ─── Ajustes del admin ───────────────────────────────────────
  ajustesPendientes: [],

  // Configuración sincronizada
  ajustes: {},

  // ─── Reportes ────────────────────────────────────────────────
  reportesPublicados: [],
};

