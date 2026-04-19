/**
 * js/audit.js — v2.0
 * ══════════════════════════════════════════════════════════════
 * Auditoría Física Ciega: identidad multiusuario, estadísticas,
 * bloqueo por usuario, reapertura por admin, inicio de ciclo.
 *
 * CAMBIOS v2.0:
 * ──────────────────────────────────────────────────────────────
 * • Bloqueo por usuario/área: cada bartender solo puede
 *   finalizar su conteo una vez. El estado queda en
 *   state.auditoriaStatusPorUsuario[userId][area].
 *
 * • reabrirConteoPorAdmin(userId, area): admin desbloquea el
 *   conteo de un usuario específico en un área. Notifica al
 *   usuario vía Firestore. También actualiza Firestore
 *   directamente en conteoPorUsuario/{area}._userLocks.
 *
 * • iniciarNuevoCiclo(): solo admin. Resetea TODOS los conteos
 *   y estados, limpia Firestore y notifica a todos los usuarios.
 *   Reemplaza auditoriaResetear() para el flujo admin.
 *
 * • renderAdminUsersPanel(): panel HTML para el admin que muestra
 *   todos los usuarios participantes con su estado por área y
 *   botones "Reabrir" por área.
 *
 * • auditoriaEntrarArea() ahora verifica si el usuario actual
 *   tiene su conteo bloqueado para ese área antes de entrar.
 *
 * • Registro en auditUserRegistry al entrar a contar.
 * ══════════════════════════════════════════════════════════════
 */

import { state }                    from './state.js';
import { AREAS_AUDITORIA,
         AREA_KEYS,
         AUDIT_TOLERANCE }          from './constants.js';
import { showNotification, showConfirm, escapeHtml } from './ui.js';
import { saveToLocalStorage }       from './storage.js';
import {
    txCloseZone,
    syncConteoAtomicoPorArea,
    syncConteoPorUsuarioToFirestore,
    resetConteoAtomicoEnFirestore,
    updateCloudSyncBadge,
}                                   from './sync.js';

// ═════════════════════════════════════════════════════════════
//  HELPERS DE IDENTIDAD
// ═════════════════════════════════════════════════════════════

/** Devuelve el userId del dispositivo actual (anónimo) o del usuario Firebase */
export function getCurrentUserId() {
    return state.auditCurrentUser?.userId
        || state.currentUser?.uid
        || 'anon';
}

/** Devuelve el nombre visible del usuario actual */
export function getCurrentUserName() {
    return state.auditCurrentUser?.userName
        || state.currentUser?.displayName
        || state.currentUser?.email?.split('@')[0]
        || 'Desconocido';
}

/** true si el usuario actual tiene su conteo bloqueado en esta área */
export function isCurrentUserLocked(area) {
    const userId = getCurrentUserId();
    return state.auditoriaStatusPorUsuario[userId]?.[area] === 'completada';
}

// ═════════════════════════════════════════════════════════════
//  IDENTIDAD DEL DISPOSITIVO
// ═════════════════════════════════════════════════════════════

export function initAuditUser() {
    try {
        const raw = localStorage.getItem('inventarioApp_auditUser');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.userId) {
                state.auditCurrentUser = parsed;
                // Sincronizar nombre con Firebase si hay sesión activa
                if (state.currentUser?.displayName && !parsed.userName.startsWith('Contador-')) {
                    // keep existing custom name
                }
                console.info('[MultiUser] Identidad recuperada:', parsed.userName,
                    '(' + parsed.userId.slice(0, 16) + '…)');
                return;
            }
        }
    } catch (_) {}

    // Usar email/nombre de Firebase si hay sesión
    const fbName = state.currentUser?.displayName
        || state.currentUser?.email?.split('@')[0]
        || null;

    const uid   = 'usr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
    const uName = fbName || ('Contador-' + Math.random().toString(36).substr(2, 4).toUpperCase());
    state.auditCurrentUser = { userId: uid, userName: uName, createdAt: Date.now() };
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); }
    catch (_) {}
    console.info('[MultiUser] Nueva identidad creada:', uName, '(' + uid.slice(0, 16) + '…)');
}

/** Registra al usuario actual en el registry de participantes */
function _registerCurrentUser() {
    const userId   = getCurrentUserId();
    const userName = getCurrentUserName();
    if (!state.auditUserRegistry) state.auditUserRegistry = {};
    state.auditUserRegistry[userId] = { userName, lastSeen: Date.now() };
}

export function setAuditUserName(newName) {
    if (!newName || !newName.trim()) { showNotification('⚠️ El nombre no puede estar vacío'); return; }
    if (!state.auditCurrentUser) initAuditUser();
    state.auditCurrentUser.userName = newName.trim().slice(0, 32);
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); } catch (_) {}
    const panel = document.getElementById('auditRenameInline');
    if (panel) panel.classList.remove('visible');
    showNotification('✅ Nombre actualizado: ' + state.auditCurrentUser.userName);
    import('./render.js').then(m => m.renderTab());
}

export function toggleAuditRename() {
    const panel = document.getElementById('auditRenameInline');
    if (!panel) return;
    const opening = !panel.classList.contains('visible');
    panel.classList.toggle('visible', opening);
    if (opening) {
        const inp = document.getElementById('auditRenameInput');
        if (inp) {
            inp.value = state.auditCurrentUser ? state.auditCurrentUser.userName : '';
            setTimeout(() => inp.focus(), 60);
        }
    }
}

export function auditSaveName() {
    const inp = document.getElementById('auditRenameInput');
    if (inp) setAuditUserName(inp.value);
}

// ═════════════════════════════════════════════════════════════
//  ESTADÍSTICAS DE MULTI-CONTEO
// ═════════════════════════════════════════════════════════════

export function calcAuditStats(productId, area) {
    const byArea  = state.auditoriaConteoPorUsuario[productId]?.[area];
    const entries = byArea ? Object.values(byArea) : [];
    if (entries.length === 0) return null;

    const totals = entries.map(u => {
        const enteras     = typeof u.enteras === 'number' ? u.enteras : 0;
        const sumAbiertas = Array.isArray(u.abiertas)
            ? u.abiertas.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0)
            : 0;
        return {
            userId:        u.userId,
            userName:      u.userName || u.userId,
            ts:            u.ts || 0,
            enteras,
            totalAbiertas: Math.round(sumAbiertas * 1000) / 1000,
            total:         Math.round((enteras + sumAbiertas) * 10000) / 10000,
        };
    });

    totals.sort((a, b) => a.ts - b.ts);
    const vals = totals.map(t => t.total);
    const sum  = Math.round(vals.reduce((a, b) => a + b, 0) * 10000) / 10000;
    const avg  = Math.round((sum / vals.length) * 10000) / 10000;
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const diff = Math.round((max - min) * 10000) / 10000;

    return {
        totals,
        sum, avg, min, max, diff,
        hasConflict: vals.length >= 2 && diff > AUDIT_TOLERANCE,
        count:       vals.length,
    };
}

function formatAuditTs(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
}

// ═════════════════════════════════════════════════════════════
//  RENDER: TRAIL DE TRAZABILIDAD
// ═════════════════════════════════════════════════════════════

export function renderAuditTrailForProduct(productId, area) {
    const stats = calcAuditStats(productId, area);
    if (!stats || stats.count === 0) return '';
    const myId  = state.auditCurrentUser?.userId;

    let html = '<div class="audit-trail">';
    html += '<div class="audit-trail-header">';
    html += `<span>${stats.count} conteo${stats.count !== 1 ? 's' : ''} registrado${stats.count !== 1 ? 's' : ''}</span>`;

    if (stats.count >= 2) {
        const badgeCls = stats.hasConflict ? 'error' : 'ok';
        const badgeLbl = stats.hasConflict
            ? `⚠️ DIFERENCIA (${stats.diff.toFixed(2)})`
            : '✓ OK';
        html += `<span class="audit-status-badge ${badgeCls}">${badgeLbl}</span>`;
    }
    html += '</div>';

    stats.totals.forEach(entry => {
        const isMe  = myId && entry.userId === myId;
        const meTxt = isMe ? ' <em style="opacity:.5;font-size:.58rem;font-style:normal">(tú)</em>' : '';
        html += `<div class="audit-trail-entry${isMe ? ' is-me' : ''}">`;
        html += `<span class="audit-entry-name">${escapeHtml(entry.userName)}${meTxt}</span>`;
        html += `<span class="audit-entry-count">${entry.enteras} ent + ${entry.totalAbiertas.toFixed(2)} ab = <strong>${entry.total.toFixed(2)}</strong></span>`;
        html += `<span class="audit-entry-ts">${formatAuditTs(entry.ts)}</span>`;
        html += '</div>';
    });

    if (stats.count >= 2) {
        const diffColor = stats.hasConflict ? 'var(--red-text)' : 'var(--green-text)';
        html += '<div class="audit-stats-row">';
        html += `<span>Σ ${stats.sum.toFixed(2)}</span>`;
        html += `<span>μ ${stats.avg.toFixed(2)}</span>`;
        html += `<span style="color:${diffColor};">Δ ${stats.diff.toFixed(2)}</span>`;
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE USUARIO (nombre del dispositivo)
// ═════════════════════════════════════════════════════════════

export function renderAuditUserPanel() {
    const user = state.auditCurrentUser;
    if (!user) return '';

    let html = `
    <div id="auditUserPanel"
         style="background:var(--surface);border:1px solid var(--border-mid);
                border-radius:var(--r-md);padding:10px 14px;margin-bottom:12px;
                display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div>
        <span style="font-size:0.68rem;font-weight:700;letter-spacing:.06em;
                     text-transform:uppercase;color:var(--txt-muted);">Contando como</span>
        <div style="font-size:0.85rem;font-weight:700;color:var(--txt-primary);margin-top:1px;">
          ${escapeHtml(user.userName)}
        </div>
      </div>
      <button onclick="window.toggleAuditRename()"
        style="padding:5px 10px;font-size:0.68rem;font-weight:700;border-radius:var(--r-sm);
               background:var(--accent-dim);border:1px solid var(--accent-dim2);
               color:var(--accent);cursor:pointer;">✏️ Cambiar</button>
    </div>
    <div id="auditRenameInline"
         style="display:none;background:var(--surface);border:1px solid var(--border-mid);
                border-radius:var(--r-md);padding:10px 14px;margin-bottom:12px;gap:8px;">
      <div class="visible" style="display:flex;gap:8px;">
        <input id="auditRenameInput" type="text" placeholder="Tu nombre o apodo"
          style="flex:1;padding:7px 10px;background:var(--card);border:1px solid var(--border-mid);
                 border-radius:var(--r-sm);color:var(--txt-primary);font-size:0.82rem;"
          onkeydown="if(event.key==='Enter')window.auditSaveName()">
        <button onclick="window.auditSaveName()"
          style="padding:7px 12px;background:var(--accent);border:none;border-radius:var(--r-sm);
                 color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;">✓</button>
      </div>
    </div>`;
    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE COMPARACIÓN MULTIUSUARIO
// ═════════════════════════════════════════════════════════════

export function renderAuditComparePanel() {
    const hasAny = state.products.some(p =>
        Object.keys(state.auditoriaConteoPorUsuario[p.id] || {}).some(area =>
            Object.keys((state.auditoriaConteoPorUsuario[p.id] || {})[area] || {}).length > 1
        )
    );
    if (!hasAny) return '';

    let conflictos = 0;
    state.products.forEach(p => {
        Object.keys(AREAS_AUDITORIA).forEach(area => {
            const stats = calcAuditStats(p.id, area);
            if (stats?.count >= 2 && stats.hasConflict) conflictos++;
        });
    });

    let html = '<div class="bg-white rounded-xl p-4 mb-4 shadow-md" style="border:1px solid var(--border-mid);">';
    html += '<p style="font-size:0.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:10px;">📊 Comparación multiusuario</p>';
    html += conflictos > 0
        ? `<p style="color:var(--red-text);font-size:0.75rem;font-weight:600;">⚠️ ${conflictos} diferencia${conflictos !== 1 ? 's' : ''} detectada${conflictos !== 1 ? 's' : ''}</p>`
        : '<p style="color:var(--green-text);font-size:0.75rem;font-weight:600;">✓ Sin conflictos detectados</p>';
    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE ADMINISTRACIÓN (solo admin)
//  Muestra todos los usuarios registrados con su estado por área
//  y botones "Reabrir" para desbloquear conteos individuales.
// ═════════════════════════════════════════════════════════════

export function renderAdminUsersPanel() {
    if (state.userRole !== 'admin') return '';

    const registry = state.auditUserRegistry || {};
    const statusMap = state.auditoriaStatusPorUsuario || {};
    const userIds   = Object.keys(registry);

    const isAdmin = true;

    let html = `
    <div class="bg-white rounded-xl p-4 mb-4 shadow-md"
         style="border:1px solid var(--border-mid);">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <p style="font-size:0.72rem;font-weight:700;letter-spacing:.07em;
                  text-transform:uppercase;color:var(--accent);">
          👥 Bartenders registrados
        </p>
        <button onclick="window.iniciarNuevoCiclo()"
          style="padding:5px 12px;background:var(--red-dim);
                 border:1px solid rgba(255,69,58,.22);border-radius:100px;
                 color:var(--red-text);font-size:0.68rem;font-weight:700;cursor:pointer;">
          🔄 Nuevo ciclo
        </button>
      </div>`;

    if (userIds.length === 0) {
        html += `<p style="font-size:0.78rem;color:var(--txt-muted);">
            Sin bartenders registrados aún. Los usuarios aparecerán aquí cuando inicien un conteo.
        </p>`;
    } else {
        html += '<div class="space-y-2">';
        userIds.forEach(userId => {
            const reg      = registry[userId];
            const userSt   = statusMap[userId] || {};
            const lastSeen = reg.lastSeen
                ? new Date(reg.lastSeen).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
                : '—';

            html += `<div style="background:var(--surface);border:1px solid var(--border);
                                  border-radius:var(--r-md);padding:10px 12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;
                          flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                <div>
                  <span style="font-size:0.82rem;font-weight:700;color:var(--txt-primary);">
                    ${escapeHtml(reg.userName || userId)}
                  </span>
                  <span style="font-size:0.65rem;color:var(--txt-muted);display:block;margin-top:1px;">
                    Última vez: ${lastSeen}
                  </span>
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">`;

            AREA_KEYS.forEach(area => {
                const locked = userSt[area] === 'completada';
                html += `<div style="display:flex;align-items:center;gap:5px;
                                      background:${locked ? 'var(--green-dim)' : 'rgba(148,163,184,.10)'};
                                      border:1px solid ${locked ? 'rgba(34,197,94,.22)' : 'var(--border)'};
                                      border-radius:var(--r-sm);padding:3px 8px;">
                  <span style="font-size:0.68rem;font-weight:700;
                                color:${locked ? 'var(--green-text)' : 'var(--txt-muted)'};">
                    ${locked ? '✓' : '⏳'} ${AREAS_AUDITORIA[area]}
                  </span>
                  ${locked
                    ? `<button
                         data-uid="${escapeHtml(userId)}"
                         data-area="${area}"
                         onclick="window.reabrirConteoPorAdmin(this.dataset.uid, this.dataset.area)"
                         style="padding:1px 7px;background:var(--amber-dim,rgba(245,158,11,.12));
                                border:1px solid rgba(245,158,11,.25);border-radius:3px;
                                color:var(--amber,#f59e0b);font-size:0.60rem;font-weight:700;
                                cursor:pointer;white-space:nowrap;">
                         Reabrir
                       </button>`
                    : ''}
                </div>`;
            });

            html += `</div></div>`;
        });
        html += '</div>';
    }

    // Botón "Publicar reporte" si todas las áreas tienen al menos 1 conteo
    const areasConDatos = AREA_KEYS.filter(area =>
        state.products.some(p => {
            const byArea = state.auditoriaConteoPorUsuario[p.id]?.[area];
            return byArea && Object.keys(byArea).length > 0;
        })
    );

    if (areasConDatos.length > 0) {
        html += `
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
          <button onclick="window.openPublicarReporteModal()"
            style="width:100%;padding:10px 0;
                   background:linear-gradient(135deg,#065f46,#047857);
                   border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
                   color:#86efac;font-size:0.82rem;font-weight:700;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;gap:8px;">
            📊 Publicar reporte final
          </button>
          <button onclick="window.exportarAuditoriaExcel()"
            style="width:100%;padding:8px 0;margin-top:6px;
                   background:linear-gradient(135deg,#1e3a5f,#1d4ed8);
                   border:1px solid rgba(59,130,246,.28);border-radius:var(--r-md);
                   color:#93c5fd;font-size:0.78rem;font-weight:700;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;gap:8px;">
            📥 Exportar Excel de auditoría
          </button>
        </div>`;
    }

    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  FLUJO DE AUDITORÍA
// ═════════════════════════════════════════════════════════════

export function auditoriaEntrarArea(area) {
    // Verificar si el usuario actual tiene su conteo bloqueado
    if (isCurrentUserLocked(area)) {
        const nombreArea = AREAS_AUDITORIA[area];
        showNotification(`🔒 Tu conteo de ${nombreArea} ya fue finalizado. Pide al administrador que lo reabra.`);
        return;
    }

    // Registrar al usuario en el registry
    _registerCurrentUser();

    state.auditoriaAreaActiva = area;
    state.auditoriaView       = 'counting';
    state.isAuditoriaMode     = true;
    state.selectedArea        = area;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

/**
 * Finaliza el conteo de la zona activa y bloquea al usuario para esa área.
 *
 * FLUJO:
 *  1. Actualización local (state + localStorage)
 *  2. Bloqueo del usuario actual (auditoriaStatusPorUsuario)
 *  3. Tres transacciones Firestore en paralelo (no bloqueantes)
 */
export function auditoriaFinalizarConteo() {
    if (!state.auditoriaAreaActiva) return;
    const area       = state.auditoriaAreaActiva;
    const nombreArea = AREAS_AUDITORIA[area];
    const userId     = getCurrentUserId();
    const userName   = getCurrentUserName();

    showConfirm(
        `¿Finalizar conteo de ${nombreArea}?\n\nTu conteo quedará guardado. No podrás modificarlo a menos que el administrador lo reabra.`,
        async () => {
            // ── 1. Actualización local optimista ─────────────────────────────
            state.auditoriaStatus[area] = 'completada';
            state.auditoriaView         = 'selection';
            state.auditoriaAreaActiva   = null;
            state.isAuditoriaMode       = false;

            // Bloquear al usuario para este área
            if (!state.auditoriaStatusPorUsuario[userId]) {
                state.auditoriaStatusPorUsuario[userId] = {
                    almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente'
                };
            }
            state.auditoriaStatusPorUsuario[userId][area] = 'completada';

            // Actualizar registry
            _registerCurrentUser();

            saveToLocalStorage();
            showNotification(`✅ Conteo de ${nombreArea} guardado y bloqueado`);

            const { renderTab } = await import('./render.js');
            renderTab();

            // ── 2. Operaciones Firestore (paralelas, no bloquean la UI) ──────
            if (!window._db || !navigator.onLine) {
                console.info(`[Audit] Sin Firebase/conexión — cierre de "${area}" guardado localmente.`);
                return;
            }

            // Notificar al admin que un área fue completada
            const usuario = state.currentUser?.email || userName;
            import('./notificaciones.js').then(m => m.enviarNotificacion({
                tipo:        'conteo',
                mensaje:     `${usuario} completó el conteo de ${nombreArea}`,
                usuarioId:   state.currentUser?.uid || userId || 'anon',
                usuarioName: usuario,
                datos:       { area, status: 'completada' },
            })).catch(() => {});

            // Sincronizar estado de bloqueo a Firestore
            _syncUserLockToFirestore(userId, area, 'completada', userName).catch(err =>
                console.warn('[Audit] syncUserLock falló (no crítico):', err?.message)
            );

            // Ejecutar las 3 transacciones en paralelo
            const [zoneResult] = await Promise.allSettled([
                txCloseZone(area).then(result => {
                    if (result.wasAlreadyClosed) {
                        console.info(`[Audit] Zona "${area}" ya estaba cerrada por otro dispositivo.`);
                    }
                    if (result.mergedStatus) {
                        const prevStatus = { ...state.auditoriaStatus };
                        state.auditoriaStatus = result.mergedStatus;
                        const changed = AREA_KEYS.some(a => prevStatus[a] !== result.mergedStatus[a]);
                        if (changed) {
                            saveToLocalStorage();
                            renderTab();
                        }
                    }
                    return result;
                }),

                syncConteoAtomicoPorArea(area).catch(err => {
                    console.warn('[Audit] syncConteoAtomicoPorArea falló (no crítico):', err?.message);
                }),

                syncConteoPorUsuarioToFirestore(area).catch(err => {
                    console.warn('[Audit] syncConteoPorUsuarioToFirestore falló (no crítico):', err?.message);
                }),
            ]);

            if (zoneResult.status === 'rejected') {
                console.error('[Audit] txCloseZone falló:', zoneResult.reason);
                showNotification('⚠️ Error al confirmar el cierre en la nube — se reintentará');
            }
        }
    );
}

export function auditoriaVolverSeleccion() {
    state.auditoriaView       = 'selection';
    state.auditoriaAreaActiva = null;
    state.isAuditoriaMode     = false;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

export function auditoriaTotalAreasCompletadas() {
    return Object.values(state.auditoriaStatus).filter(s => s === 'completada').length;
}

export function auditoriaTodasCompletas() {
    return Object.values(state.auditoriaStatus).every(s => s === 'completada');
}

// ═════════════════════════════════════════════════════════════
//  REABRIR CONTEO (solo admin)
// ═════════════════════════════════════════════════════════════

/**
 * Desbloquea el conteo de un usuario específico en un área.
 * Solo el admin puede ejecutar esta función.
 * Notifica al usuario via Firestore.
 *
 * @param {string} userId  — ID del usuario a desbloquear
 * @param {string} area    — área a desbloquear ('almacen'|'barra1'|'barra2')
 */
export async function reabrirConteoPorAdmin(userId, area) {
    if (state.userRole !== 'admin') {
        showNotification('⛔ Solo el administrador puede reabrir conteos');
        return;
    }

    const registry  = state.auditUserRegistry || {};
    const userName  = registry[userId]?.userName || userId;
    const nombreArea = AREAS_AUDITORIA[area];

    const ok = await showConfirm(
        `¿Reabrir el conteo de "${userName}" en ${nombreArea}?\n\nEl usuario podrá modificar y volver a finalizar su conteo.`
    );
    if (!ok) return;

    // Actualizar estado local
    if (!state.auditoriaStatusPorUsuario[userId]) {
        state.auditoriaStatusPorUsuario[userId] = {
            almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente'
        };
    }
    state.auditoriaStatusPorUsuario[userId][area] = 'pendiente';
    saveToLocalStorage();

    showNotification(`🔓 Conteo de ${userName} en ${nombreArea} reabierto`);
    import('./render.js').then(m => m.renderTab());

    // Sincronizar a Firestore y notificar al usuario
    if (window._db && navigator.onLine) {
        try {
            await _syncUserLockToFirestore(userId, area, 'pendiente', userName);

            // Notificar al bartender
            const adminName = state.currentUser?.email || 'Admin';
            import('./notificaciones.js').then(m => m.enviarNotificacion({
                tipo:        'reapertura',
                mensaje:     `El administrador reabrió tu conteo de ${nombreArea} — puedes modificarlo ahora`,
                usuarioId:   userId,
                usuarioName: adminName,
                datos:       { area, status: 'pendiente', reabiertoPor: adminName },
            })).catch(() => {});

        } catch (err) {
            console.warn('[Audit] Error al sincronizar reapertura:', err?.message);
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  INICIO DE NUEVO CICLO (solo admin)
// ═════════════════════════════════════════════════════════════

/**
 * Inicia un nuevo ciclo de inventario.
 * Solo el admin puede ejecutarlo.
 * Resetea TODOS los conteos, estados y notifica a todos los usuarios.
 */
export function iniciarNuevoCiclo() {
    if (state.userRole !== 'admin') {
        showNotification('⛔ Solo el administrador puede iniciar un nuevo ciclo');
        return;
    }

    if (!navigator.onLine) {
        showNotification('⚠️ Necesitas conexión para iniciar un nuevo ciclo');
        return;
    }

    showConfirm(
        '⚠️ ¿Iniciar nuevo ciclo de inventario?\n\nSe borrarán TODOS los conteos, estados y bloqueos de todos los usuarios en las tres áreas. Esta acción notificará a todos los bartenders.',
        async () => {
            // Reset completo del estado
            state.auditoriaStatus           = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
            state.auditoriaConteo           = {};
            state.auditoriaConteoPorUsuario = {};
            state.auditoriaStatusPorUsuario = {};
            state.auditUserRegistry         = {};
            state.auditoriaView             = 'selection';
            state.auditoriaAreaActiva       = null;
            state.isAuditoriaMode           = false;
            saveToLocalStorage();

            showNotification('🔄 Nuevo ciclo iniciado');
            const { renderTab } = await import('./render.js');
            renderTab();

            // Notificar a todos los usuarios
            if (window._db && navigator.onLine) {
                const adminName = state.currentUser?.email || 'Admin';
                import('./notificaciones.js').then(m => m.enviarNotificacion({
                    tipo:        'nuevo_ciclo',
                    mensaje:     `🔄 El administrador inició un nuevo ciclo de inventario. Por favor realiza tu conteo.`,
                    usuarioId:   'broadcast',
                    usuarioName: adminName,
                    datos:       { timestamp: Date.now() },
                })).catch(() => {});

                // Reset en Firestore
                try {
                    await resetConteoAtomicoEnFirestore();
                    // Limpiar estados de bloqueo en Firestore
                    await _resetUserLocksInFirestore();
                    console.info('[Audit] ✓ Nuevo ciclo completado en Firestore.');
                } catch (err) {
                    console.warn('[Audit] Reset Firestore falló — se reintentará:', err?.message);
                }
            }
        }
    );
}

/**
 * Resetear auditoría (mantiene por compatibilidad).
 * Ahora delega a iniciarNuevoCiclo si es admin,
 * o muestra mensaje de error si no lo es.
 */
export function auditoriaResetear() {
    if (state.userRole !== 'admin') {
        showNotification('⛔ Solo el administrador puede iniciar una nueva auditoría');
        return;
    }
    iniciarNuevoCiclo();
}

// ═════════════════════════════════════════════════════════════
//  HELPERS DE SINCRONIZACIÓN FIRESTORE
// ═════════════════════════════════════════════════════════════

/**
 * Escribe el estado de bloqueo de un usuario en Firestore.
 * Estructura: /inventarioApp/{docId}/conteoPorUsuario/{area}
 * Campo: _userLocks.{userId} = { status, userName, ts }
 */
async function _syncUserLockToFirestore(userId, area, status, userName) {
    if (!window._db || !window.FIRESTORE_DOC_ID) return;
    const docRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario')
        .doc(area);

    await docRef.set({
        _userLocks: {
            [userId]: { status, userName, ts: Date.now() }
        }
    }, { merge: true });
}

/**
 * Limpia todos los bloqueos de usuario en Firestore para todas las áreas.
 */
async function _resetUserLocksInFirestore() {
    if (!window._db || !window.FIRESTORE_DOC_ID) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario');

    const batch = window._db.batch();
    AREA_KEYS.forEach(area => {
        batch.set(baseRef.doc(area), { _userLocks: {} }, { merge: true });
    });
    await batch.commit();
}

/**
 * Lee los bloqueos de usuario desde Firestore y los aplica al estado local.
 * Llamado por el listener de conteoPorUsuario cuando llega un snapshot.
 */
export function applyUserLocksFromSnapshot(area, data) {
    if (!data || !data._userLocks) return;
    const locks = data._userLocks;

    Object.entries(locks).forEach(([userId, lockData]) => {
        if (!state.auditoriaStatusPorUsuario[userId]) {
            state.auditoriaStatusPorUsuario[userId] = {
                almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente'
            };
        }
        if (lockData.status === 'completada' || lockData.status === 'pendiente') {
            state.auditoriaStatusPorUsuario[userId][area] = lockData.status;
        }
        // Actualizar registry
        if (lockData.userName) {
            if (!state.auditUserRegistry) state.auditUserRegistry = {};
            state.auditUserRegistry[userId] = {
                userName: lockData.userName,
                lastSeen: lockData.ts || Date.now(),
            };
        }
    });
}

// ── Bindings globales ─────────────────────────────────────────
window.auditSaveName            = auditSaveName;
window.toggleAuditRename        = toggleAuditRename;
window.auditoriaEntrarArea      = auditoriaEntrarArea;
window.auditoriaFinalizarConteo = auditoriaFinalizarConteo;
window.auditoriaVolverSeleccion = auditoriaVolverSeleccion;
window.auditoriaResetear        = auditoriaResetear;
window.reabrirConteoPorAdmin    = reabrirConteoPorAdmin;
window.iniciarNuevoCiclo        = iniciarNuevoCiclo;
