/**
 * js/state.js — v2.5
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 *
 * CAMBIOS v2.5:
 *   • auditoriaStatusPorUsuario — mapa { [userId]: { almacen, barra1, barra2 } }
 *     donde cada valor es 'pendiente' | 'completada'.
 *     Permite que cada bartender tenga su propio estado de bloqueo
 *     por área, independientemente del estado global de la zona.
 *     El admin puede reabrir el conteo de cualquier usuario.
 *
 *   • auditUserRegistry — mapa { [userId]: { userName, lastSeen } }
 *     Registro de todos los usuarios que han participado en la auditoría
 *     activa. Usado por el panel de administración en la vista de inventario.
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

  // Estado GLOBAL de zona (al menos un usuario completó)
  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // Área activa en pantalla de conteo
  auditoriaAreaActiva: null,

  // Sub-vista: 'selection' | 'counting'
  auditoriaView: 'selection',

  // Flag de modo auditoría activo.
  isAuditoriaMode: false,

  // ─── Multi-usuario ────────────────────────────────────────────
  // { [productId]: { [area]: { [userId]: { enteras, abiertas, ts, userName } } } }
  auditoriaConteoPorUsuario: {},

  // { userId, userName, role }
  auditCurrentUser: null,

  // ─── NUEVO v2.5: Estado de bloqueo POR USUARIO ───────────────
  // { [userId]: { almacen: 'pendiente'|'completada',
  //               barra1:  'pendiente'|'completada',
  //               barra2:  'pendiente'|'completada' } }
  // • Un bartender no puede modificar un área que él mismo finalizó.
  // • El admin puede resetear cualquier valor a 'pendiente'.
  // • Se sincroniza a Firestore en conteoPorUsuario/_statusUsuarios
  auditoriaStatusPorUsuario: {},

  // ─── NUEVO v2.5: Registro de participantes en la auditoría ───
  // { [userId]: { userName: string, lastSeen: number } }
  // • Permite al admin ver qué dispositivos han contado.
  // • Se actualiza cada vez que un usuario entra a contar.
  auditUserRegistry: {},

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
  adjustmentsPending: [],

  // ─── Notificaciones ──────────────────────────────────────────
  notifications:       [],
  notificationsUnread: 0,

  // ─── Ajustes del admin ───────────────────────────────────────
  ajustesPendientes: [],
  ajustes: {},

  // ─── Reportes ────────────────────────────────────────────────
  reportesPublicados: [],
};
