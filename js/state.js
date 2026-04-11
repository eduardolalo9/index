/**
 * js/state.js — v2.4 DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 * TODAS las propiedades que cualquier módulo lee/escribe deben
 * estar declaradas aquí — sin excepción.
 *
 * CORRECCIONES ACUMULADAS:
 *
 * v2.2 — añadidas:
 *   • currentUser        — auth-roles.js: _applyRoleToState()
 *   • userProfile        — auth-roles.js: _applyRoleToState()
 *   • adjustmentsPending — app.js: subirAjustesPendientes() al reconectar
 *   • auditoriaAreaActiva — render.js: pantalla de conteo de auditoría
 *
 * v2.3 — añadidas:
 *   • auditoriaView      — audit.js lo escribe ('counting'|'selection')
 *   • notifications      — notificaciones.js usa state.notifications (inglés)
 *   • notificationsUnread — notificaciones.js para el badge
 *   • ajustesPendientes  — ajustes.js y render.js
 *
 * v2.4 — añadida:
 *   • isAuditoriaMode    — audit.js escribe true/false en auditoriaEntrarArea,
 *                          auditoriaFinalizarConteo y auditoriaResetear.
 *                          Sin declarar aquí era asignación dinámica no tipada.
 *                          actions.js lo lee para saber si actualizar auditoriaConteo
 *                          en openInventarioModal (fix del conteo en modo auditoría).
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

  // ─── Catálogo de productos (fuente: Admin) ──────────────────
  products: [],

  // ─── Carrito (pedidos en curso) ─────────────────────────────
  cart: [],

  // ─── Historial ──────────────────────────────────────────────
  orders:      [],   // Pedidos completados (solo local, NO se sincronizan)
  inventories: [],   // Historiales de inventario (se sincronizan chunkeados)

  // ─── Navegación / UI ────────────────────────────────────────
  activeTab:     'inicio',
  selectedArea:  'almacen',
  selectedGroup: 'Todos',
  searchTerm:    '',

  // ─── Inventario operativo (conteo diario por área) ──────────
  // Estructura: { [productId]: { almacen: number, barra1: number, barra2: number } }
  inventarioConteo: {},

  // ─── Auditoría (conteo de verificación ciega) ───────────────
  // Estructura: { [productId]: { [area]: { enteras: n, abiertas: [...oz] } } }
  auditoriaConteo: {},

  // Estado de cada zona: 'pendiente' | 'en_progreso' | 'completada'
  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // Área activa en pantalla de conteo
  auditoriaAreaActiva: null,

  // Sub-vista de auditoría: 'selection' | 'counting'
  auditoriaView: 'selection',

  // FIX v2.4: audit.js lo escribe en auditoriaEntrarArea/Finalizar/Resetear.
  // actions.js lo lee para decidir si actualizar auditoriaConteo al guardar.
  isAuditoriaMode: false,

  // ─── Multi-usuario (conteo por persona) ─────────────────────
  // Estructura: { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // ─── Usuario actual de auditoría ────────────────────────────
  // { userId: string, userName: string, role: 'admin'|'user' }
  auditCurrentUser: null,

  // ─── Sesión de autenticación ──────────────────────────────────
  currentUser:  null,   // firebase.User | null  — asignado por auth-roles.js
  userProfile:  null,   // { uid, email, displayName, role, ... } — ídem

  // ─── Rol del usuario autenticado ────────────────────────────
  // 'admin' | 'user' | null (null = modo dev, se trata como admin)
  userRole: null,

  // ─── Sincronización ─────────────────────────────────────────
  syncEnabled:        true,
  _cloudSyncPending:  false,
  _syncInProgress:    false,
  _lastCloudSync:     0,
  _lastDataHash:      '',

  // ─── Ajustes pendientes offline ───────────────────────────────
  adjustmentsPending: [],

  // ─── Notificaciones ───────────────────────────────────────────
  notifications:       [],
  notificationsUnread: 0,

  // ─── Ajustes pendientes del admin ─────────────────────────────
  ajustesPendientes: [],

  // ─── Config de ajustes sincronizada ──────────────────────────
  ajustes: {},

  // ─── Reportes ───────────────────────────────────────────────
  reportesPublicados: [],
};
 
