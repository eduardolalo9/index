/**
 * js/render.js — Motor de renderizado de tabs (SPA sin framework).
 * Genera HTML como strings y lo inyecta en #tabContent.
 * v2.1 — Multiusuario + Historia completa + Panel Admin Auditoría
 *
 * CAMBIOS v2.1:
 * • renderAuditoriaSeleccion() — Panel admin de usuarios registrados
 *   (renderAdminUsersPanel), ocultado "Nueva auditoría" para usuarios.
 *   Indicador de bloqueo por área en las tarjetas de área.
 * • renderAuditoriaConteo() — Indica si el conteo está bloqueado.
 * • renderHistoriaTab() — Sección "Reportes Publicados" integrada
 *   al inicio del tab Historia, visible para todos los roles.
 */
import { state } from './state.js';
import { AREAS, AREAS_AUDITORIA, AREAS_AUDITORIA_FA, AREA_KEYS } from './constants.js';
import { escapeHtml, updateHeaderActions } from './ui.js';
import { saveToLocalStorage } from './storage.js';
import {
  filterByGroup, getAvailableGroups, getTotalStock
} from './products.js';
import {
  renderAuditTrailForProduct, renderAuditUserPanel,
  renderAuditComparePanel, auditoriaTotalAreasCompletadas,
  auditoriaTodasCompletas, renderAdminUsersPanel, isCurrentUserLocked,
} from './audit.js';
import { renderNotificacionesPanel } from './notificaciones.js';
import { renderAjustesPendientesPanel } from './ajustes.js';
import { renderReportesPublicados } from './reportes.js';

/* ── Utilidad de scroll/foco ─────────────────────────────────── */
function _getElementSelector(el) {
  if (!el || el === document.body) return null;
  if (el.id) return '#' + el.id;
  if (el.tagName === 'INPUT' && el.placeholder === 'Buscar...') return '#tabContent input[placeholder="Buscar..."]';
  const parent = el.closest('[data-render-key]');
  if (parent) return '[data-render-key="' + parent.dataset.renderKey + '"] ' + el.tagName.toLowerCase();
  return null;
}

/* ── Punto de entrada principal ──────────────────────────────── */
export function renderTab() {
  updateHeaderActions();
  const content = document.getElementById('tabContent');
  if (!content) return;

  const scrollY         = window.scrollY || window.pageYOffset;
  const focused         = document.activeElement;
  const focusedSelector = _getElementSelector(focused);
  const cursorPos       = (focused && focused.selectionStart !== undefined) ? focused.selectionStart : null;
  const focusedValue    = (focused && focused.tagName === 'INPUT') ? focused.value : null;

  content.style.animation = 'none';
  void content.offsetWidth;
  content.style.animation = '';

  switch (state.activeTab) {
    case 'inicio':          content.innerHTML = renderInicioTab();          break;
    case 'productos':       content.innerHTML = renderProductosTab();       break;
    case 'pedidos':         content.innerHTML = renderPedidosTab();         break;
    case 'inventario':      content.innerHTML = renderInventarioTab();      break;
    case 'historia':        content.innerHTML = renderHistoriaTab();        break;
    case 'notificaciones':  content.innerHTML = renderNotificacionesTab();  break;
    case 'ajustes':         content.innerHTML = renderAjustesTab();         break;
    default:
      console.warn('[Render] Tab desconocido:', state.activeTab, '— mostrando inicio.');
      state.activeTab = 'inicio';
      content.innerHTML = renderInicioTab();
      break;
  }

  requestAnimationFrame(() => {
    window.scrollTo(0, scrollY);
    if (focusedSelector) {
      const el = document.querySelector(focusedSelector);
      if (el) {
        el.focus();
        if (cursorPos !== null && el.tagName === 'INPUT') {
          try { el.setSelectionRange(cursorPos, cursorPos); } catch (_) {}
        }
        if (focusedValue !== null && el.tagName === 'INPUT' && el.value !== focusedValue) {
          el.value = focusedValue;
        }
      }
    }
  });
}

export function switchTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const indicator = btn.querySelector('.tab-indicator');
    if (btn.dataset.tab === tab) {
      btn.classList.remove('text-gray-600');
      btn.classList.add('text-gray-900');
      if (!indicator) {
        const div = document.createElement('div');
        div.className =
          'tab-indicator absolute bottom-0 left-0 right-0 h-1 ' +
          'bg-gradient-to-r from-purple-500 to-orange-500 rounded-t-full animate-slideIn';
        btn.appendChild(div);
      }
    } else {
      btn.classList.remove('text-gray-900');
      btn.classList.add('text-gray-600');
      if (indicator) indicator.remove();
    }
  });

  document.querySelectorAll('.sb-item').forEach(btn => {
    if (btn.dataset.sbTab === tab) btn.classList.add('sb-active');
    else btn.classList.remove('sb-active');
  });

  saveToLocalStorage();
  renderTab();
}

/* ═══════════════════════════════════════════════════════════════
   TAB: INICIO
═══════════════════════════════════════════════════════════════ */
function renderInicioTab() {
  const isAdmin     = state.userRole === 'admin';
  const roleLoading = state.userRole === null;
  const filtered    = filterByGroup();
  const groups      = getAvailableGroups();
  const totalProducts = state.products.length;
  const totalStock    = state.products.reduce((s, p) => s + getTotalStock(p), 0);

  let html = '<div class="space-y-4">';

  html += '<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">';
  html += _statCard('📦', 'Productos',   totalProducts,                                          'var(--accent)');
  html += _statCard('📊', 'Stock total', totalStock.toFixed(1),                                  'var(--green)');
  html += _statCard('🛒', 'En carrito',  state.cart.reduce((s,i)=>s+i.quantity,0).toFixed(1),    'var(--amber)');
  html += _statCard('📋', 'Pedidos',     state.orders.length,                                    'var(--sky)');
  html += '</div>';

  html += '<div class="filter-bar">';
  html += `<input type="text" placeholder="Buscar producto…"
    value="${escapeHtml(state.searchTerm)}"
    oninput="window.updateSearchTerm(this.value)"
    class="field-input">`;
  html += `<select onchange="window.updateSelectedGroup(this.value)" class="field-select">`;
  groups.forEach(g => {
    html += `<option value="${escapeHtml(g)}"${state.selectedGroup === g ? ' selected' : ''}>${escapeHtml(g)}</option>`;
  });
  html += '</select>';

  if (isAdmin) {
    html += `<button onclick="window.openProductModal()"
      class="px-3 py-2 bg-gradient-to-r from-purple-500 to-blue-500
             text-white rounded-lg text-sm font-semibold flex items-center gap-1.5">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
      </svg>
      Producto
    </button>`;

    html += `<button
        onclick="var fi=document.getElementById('fileInput');if(!fi){window.showNotification('⚠️ Error');return;}fi.value='';fi.click();"
        class="px-3 py-2 bg-gradient-to-r from-green-600 to-emerald-600
               text-white rounded-lg text-sm font-semibold flex items-center gap-1.5"
        title="Importar catálogo desde Excel">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        Excel
    </button>`;
  } else if (roleLoading) {
    html += `<span style="font-size:0.7rem;color:var(--txt-muted);padding:6px 8px;">⏳ Verificando rol…</span>`;
  }
  html += '</div>';

  if (filtered.length === 0) {
    html += `<div class="bg-white rounded-xl p-10 text-center shadow-md">
      <div style="font-size:2.5rem;margin-bottom:10px;">📦</div>
      <p class="text-gray-500 font-medium">No hay productos que mostrar</p>
    </div>`;
  } else {
    html += '<div class="space-y-2">';
    filtered.forEach((p, idx) => {
      const total = getTotalStock(p);
      const delay = Math.min(idx * 25, 300);
      html += `<div class="product-card" style="animation:cardIn 0.2s ease-out ${delay}ms both">`;
      html += '<div class="product-card__body">';
      html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">';
      html += '<div style="flex:1;min-width:0;">';
      html += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px;">
        <span class="product-card__name">${escapeHtml(p.name)}</span>
        <span class="product-card__group">${escapeHtml(p.group || 'General')}</span>
      </div>`;
      html += `<div class="product-card__meta">
        ${escapeHtml(p.id)} · ${escapeHtml(p.unit || '')} · Total: <strong style="color:var(--txt-primary)">${total.toFixed(2)}</strong>
      </div>`;
      html += '</div>';
      html += '<div style="display:flex;gap:6px;flex-shrink:0;">';

      html += `<button data-id="${escapeHtml(p.id)}" onclick="window.addToCart(this.dataset.id)"
        title="Agregar al carrito" class="p-2 bg-gradient-to-br from-purple-500 to-blue-500 text-white rounded-lg text-xs">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
        </svg></button>`;

      if (!isAdmin) {
        html += `<button data-id="${escapeHtml(p.id)}" onclick="window.openAjusteModal(this.dataset.id)"
          title="Solicitar ajuste" class="p-2 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-lg text-xs">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>
          </svg></button>`;
      }

      if (isAdmin) {
        html += `<button data-id="${escapeHtml(p.id)}" onclick="window.editProduct(this.dataset.id)"
          title="Editar" class="p-2 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-lg text-xs">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
          </svg></button>`;
        html += `<button data-id="${escapeHtml(p.id)}" onclick="window.deleteProduct(this.dataset.id)"
          title="Eliminar" class="p-2 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-lg text-xs">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg></button>`;
      }

      html += '</div></div></div>';
      html += '<div class="product-card__areas">';
      AREA_KEYS.forEach(area => {
        const val = p.stockByArea?.[area] ?? 0;
        html += `<div class="area-chip">
          <span class="area-chip__name">${AREAS[area]}</span>
          <span class="area-chip__val">${val.toFixed(2)}</span>
        </div>`;
      });
      html += '</div></div>';
    });
    html += '</div>';
  }

  if (isAdmin && state.products.length > 0) {
    html += `<button onclick="window.deleteAllProducts()"
      class="w-full py-2 bg-gradient-to-r from-red-500 to-orange-500
             text-white rounded-lg text-sm font-semibold opacity-60 hover:opacity-100 transition-opacity">
      Eliminar todos los productos
    </button>`;
  }

  const syncOn = state.syncEnabled !== false;
  html += `<div class="bg-white rounded-xl p-4 shadow-md">
    <h3 style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);margin-bottom:10px;letter-spacing:0.02em;">
      ⚙️ SINCRONIZACIÓN
    </h3>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:0.8rem;font-weight:600;color:var(--txt-primary);">${syncOn ? '☁️ Activa' : '📴 Pausada'}</div>
        <div style="font-size:0.7rem;color:var(--txt-muted);margin-top:2px;">${syncOn ? 'Datos subiéndose automáticamente.' : 'Solo guardado local.'}</div>
      </div>
      <button onclick="window.toggleSync()"
        style="padding:8px 16px;border-radius:100px;font-size:0.78rem;font-weight:700;cursor:pointer;
               background:${syncOn ? 'var(--red-dim)' : 'var(--accent-dim)'};
               border:1px solid ${syncOn ? 'rgba(255,69,58,.22)' : 'var(--accent-dim2)'};
               color:${syncOn ? 'var(--red-text)' : 'var(--accent)'};">
        ${syncOn ? '⏸ Pausar' : '▶ Activar'}
      </button>
    </div>
  </div>`;

  html += '</div>';
  return html;
}

function _statCard(icon, label, value, colorVar) {
  const colorMap = {
    'var(--accent)': { bg: 'rgba(10,132,255,0.12)',  border: 'rgba(10,132,255,0.18)' },
    'var(--green)':  { bg: 'rgba(48,209,88,0.10)',   border: 'rgba(48,209,88,0.16)'  },
    'var(--amber)':  { bg: 'rgba(255,159,10,0.10)',  border: 'rgba(255,159,10,0.16)' },
    'var(--sky)':    { bg: 'rgba(100,210,255,0.10)', border: 'rgba(100,210,255,0.16)'},
  };
  const c = colorMap[colorVar] || colorMap['var(--accent)'];
  return `<div class="stat-card">
    <div class="stat-card__icon" style="background:${c.bg};border:1px solid ${c.border}">${icon}</div>
    <div class="stat-card__val" style="color:${colorVar}">${value}</div>
    <div class="stat-card__label">${label}</div>
  </div>`;
}

function renderProductosTab() { return renderInicioTab(); }

/* ═══════════════════════════════════════════════════════════════
   TAB: PEDIDOS
═══════════════════════════════════════════════════════════════ */
function renderPedidosTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-4">';

  html += `<div style="display:flex;align-items:center;justify-content:space-between;">
    <div>
      <h3 style="font-size:1rem;font-weight:700;color:var(--txt-primary);letter-spacing:-0.01em;">Pedidos WhatsApp</h3>
      <p style="font-size:0.68rem;color:var(--txt-muted);margin-top:2px;">Solo en este dispositivo</p>
    </div>
  </div>`;

  if (state.orders.length === 0) {
    html += `<div class="bg-white rounded-xl p-10 text-center shadow-md">
      <div style="font-size:2.5rem;margin-bottom:10px;">🛒</div>
      <p class="text-gray-500 font-medium">No hay pedidos todavía</p>
      <p style="font-size:0.75rem;color:var(--txt-muted);margin-top:6px;">Ve a Inicio, agrega productos con 🛒 y genera un pedido</p>
    </div>`;
    html += '</div>';
    return html;
  }

  html += '<div class="space-y-4">';
  state.orders.forEach((order, idx) => {
    const delay = Math.min(idx * 50, 400);
    html += `<div class="bg-white rounded-2xl p-4 shadow-md" style="animation:cardIn 0.2s ease-out ${delay}ms both;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
      <div>
        <h3 style="font-weight:700;color:var(--txt-primary);font-size:0.875rem;">${escapeHtml(order.id)}</h3>
        <p style="font-size:0.7rem;color:var(--txt-muted);margin-top:2px;">
          ${escapeHtml(order.date)} · ${escapeHtml(order.supplier || '—')}
          ${order.deliveryDate ? ` · Entrega: ${escapeHtml(order.deliveryDate)}` : ''}
        </p>
      </div>
      <div style="display:flex;gap:6px;">
        <button data-id="${escapeHtml(order.id)}" onclick="window.shareOrderWhatsApp(this.dataset.id)"
          title="Compartir WhatsApp" class="p-2 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-xl">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
          </svg></button>`;
    if (isAdmin) {
      html += `<button data-id="${escapeHtml(order.id)}" onclick="window.deleteOrder(this.dataset.id)"
        title="Eliminar" class="p-2 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg></button>`;
    }
    html += '</div></div>';
    html += '<div class="overflow-x-auto"><table class="w-full"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr>'
          + '<th class="px-3 py-2 text-left text-xs text-white">Producto</th>'
          + '<th class="px-3 py-2 text-center text-xs text-white">Unidad</th>'
          + '<th class="px-3 py-2 text-center text-xs text-white">Cantidad</th>'
          + '</tr></thead><tbody class="divide-y divide-gray-200">';
    order.products.forEach(p => {
      html += `<tr><td class="px-3 py-2 text-gray-900 text-sm">${escapeHtml(p.name)}</td>
        <td class="px-3 py-2 text-center text-gray-600 text-sm">${escapeHtml(p.unit)}</td>
        <td class="px-3 py-2 text-center font-semibold text-gray-900 text-sm">${p.quantity}</td></tr>`;
    });
    html += '</tbody></table></div>';
    html += `<div style="margin-top:8px;text-align:right;">
      <span style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);">Total: ${(order.total || 0).toFixed(2)}</span>
    </div>`;
    if (order.note) {
      html += `<div style="margin-top:8px;padding:8px 10px;background:var(--accent-dim);border-radius:var(--r-sm);border:1px solid var(--accent-dim2);">
        <p style="font-size:0.75rem;color:var(--txt-secondary);">📝 ${escapeHtml(order.note)}</p>
      </div>`;
    }
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: INVENTARIO (Auditoría física ciega)
═══════════════════════════════════════════════════════════════ */
function renderInventarioTab() {
  if (state.auditoriaView === 'counting' && state.auditoriaAreaActiva)
    return renderAuditoriaConteo();
  return renderAuditoriaSeleccion();
}

function renderAuditoriaSeleccion() {
  const isAdmin        = state.userRole === 'admin';
  const totalCompletas = auditoriaTotalAreasCompletadas();
  const porcentaje     = Math.round((totalCompletas / 3) * 100);
  const todasCompletas = auditoriaTodasCompletas();

  let html = '<div class="audit-screen">';

  // ── Cabecera ──────────────────────────────────────────────────
  html += '<div class="bg-white rounded-xl p-4 sm:p-5 mb-4 shadow-md">';
  html += '<div class="flex items-start justify-between gap-3 mb-3"><div>';
  html += '<p class="audit-header-title">Auditoría Física Ciega</p>';
  html += '<p class="audit-header-sub">Selecciona el área de auditoría para iniciar el conteo físico.</p>';
  html += '</div>';

  // Botón "Nuevo ciclo" — SOLO ADMIN
  if (isAdmin) {
    html += `<button onclick="window.iniciarNuevoCiclo()"
      title="Iniciar nuevo ciclo de inventario"
      style="flex-shrink:0;padding:6px 12px;border-radius:100px;
             background:var(--red-dim);border:1px solid rgba(255,69,58,0.18);
             color:var(--red-text);font-size:0.7rem;font-weight:700;cursor:pointer;"
      class="flex items-center gap-1.5">
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
      </svg>
      Nuevo ciclo
    </button>`;
  }
  html += '</div>';

  // Barra de progreso
  html += `<div class="flex items-center gap-3">
    <div style="font-size:0.68rem;font-weight:700;color:var(--txt-muted);white-space:nowrap;">${totalCompletas} / 3 áreas</div>
    <div class="audit-progress-bar" style="flex:1;">
      <div class="audit-progress-fill" style="width:${porcentaje}%;"></div>
    </div>
    <div style="font-size:0.68rem;font-weight:700;color:${todasCompletas ? 'var(--green)' : 'var(--accent)'};white-space:nowrap;">${porcentaje}%</div>
  </div>`;
  html += '</div>';

  // Panel de usuario (nombre del contador)
  html += renderAuditUserPanel();

  // Panel de comparación multiusuario
  html += renderAuditComparePanel();

  // ── Panel de administración (solo admin) ─────────────────────
  if (isAdmin) {
    html += renderAdminUsersPanel();
  }

  // ── Tarjetas de áreas ─────────────────────────────────────────
  html += '<div class="flex flex-col gap-3 mb-4">';
  ['almacen', 'barra1', 'barra2'].forEach(area => {
    const isCompleta = state.auditoriaStatus[area] === 'completada';
    const myLocked   = isCurrentUserLocked(area);

    // Contar cuántos usuarios han completado esta área
    const registry   = state.auditUserRegistry || {};
    const statusMap  = state.auditoriaStatusPorUsuario || {};
    const totalUsers = Object.keys(registry).length;
    const doneUsers  = Object.values(statusMap).filter(u => u[area] === 'completada').length;

    html += `<div class="audit-area-card${isCompleta ? ' completada' : ''}${myLocked ? ' locked' : ''}"
      onclick="window.auditoriaEntrarArea('${area}')"
      role="button" tabindex="0"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.auditoriaEntrarArea('${area}')}"
      style="cursor:${myLocked ? 'not-allowed' : 'pointer'};">`;

    html += `<div class="audit-area-icon"><i class="${AREAS_AUDITORIA_FA[area]}"></i></div>`;

    html += `<div class="audit-area-info">
      <div class="audit-area-name">${AREAS_AUDITORIA[area]}</div>
      <span class="audit-area-status ${isCompleta ? 'completada' : 'pendiente'}">
        ${isCompleta ? '✓ Con datos' : '⏳ Pendiente'}
      </span>
      ${myLocked
        ? `<span style="font-size:0.60rem;color:var(--amber,#f59e0b);display:block;margin-top:2px;">🔒 Tu conteo: finalizado</span>`
        : `<span style="font-size:0.60rem;color:var(--txt-muted);display:block;margin-top:2px;">
             ${totalUsers > 0 ? `${doneUsers}/${totalUsers} bartenders listos` : 'Sin conteos aún'}
           </span>`}
    </div>`;

    html += `<svg class="audit-area-arrow w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
    </svg>`;
    html += '</div>';
  });
  html += '</div>';

  // Botón exportar — solo admin cuando hay datos
  if (isAdmin) {
    const hayDatos = state.products.some(p =>
      AREA_KEYS.some(a => {
        const c = state.auditoriaConteo[p.id]?.[a];
        return c && (c.enteras > 0 || (c.abiertas && c.abiertas.length > 0));
      })
    );
    if (hayDatos) {
      html += `<button onclick="window.exportarAuditoriaExcel()" class="audit-export-btn">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        Exportar Auditoría a Excel
      </button>`;
    }
  }

  html += '</div>';
  return html;
}

function renderAuditoriaConteo() {
  const area      = state.auditoriaAreaActiva;
  const areaLabel = AREAS_AUDITORIA[area];
  const filtered  = filterByGroup();
  const myLocked  = isCurrentUserLocked(area);

  let html = '<div>';

  html += '<div class="audit-count-header">';
  html += `<div class="flex items-center gap-2 mb-2">
    <button onclick="window.auditoriaVolverSeleccion()" class="audit-back-btn">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/>
      </svg>Volver
    </button>
    <span class="audit-count-area-badge">
      <i class="${AREAS_AUDITORIA_FA[area]}"></i>${areaLabel}
    </span>
    ${myLocked
      ? `<span style="font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:100px;
                      background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);
                      color:var(--amber,#f59e0b);">🔒 Conteo bloqueado</span>`
      : ''}
  </div>`;
  html += `<p style="font-size:0.7rem;color:var(--txt-muted);">Conteo ciego · ${filtered.length} productos</p>`;
  html += '</div>';

  // Alerta de bloqueo
  if (myLocked) {
    html += `<div style="background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.25);
                          border-radius:var(--r-md);padding:10px 14px;margin-bottom:12px;">
      <p style="font-size:0.78rem;font-weight:600;color:var(--amber,#f59e0b);">
        🔒 Tu conteo de ${areaLabel} ya fue finalizado.
      </p>
      <p style="font-size:0.70rem;color:var(--txt-muted);margin-top:3px;">
        Puedes ver tus datos pero no modificarlos. Solicita al administrador que reabra tu conteo si necesitas corregir algo.
      </p>
    </div>`;
  }

  const _invGroups = getAvailableGroups();
  html += `<div class="mb-3 flex gap-2">
    <input type="text" placeholder="Buscar…"
      value="${escapeHtml(state.searchTerm)}"
      oninput="window.updateSearchTerm(this.value)"
      class="field-input">
    <select onchange="window.updateSelectedGroup(this.value)" class="field-select" style="flex-shrink:0;">`;
  _invGroups.forEach(g => {
    html += `<option value="${escapeHtml(g)}"${state.selectedGroup === g ? ' selected' : ''}>${escapeHtml(g)}</option>`;
  });
  html += '</select></div>';

  html += '<div class="space-y-2">';
  filtered.forEach(p => {
    const conteo   = state.auditoriaConteo[p.id]?.[area] || { enteras: 0, abiertas: [] };
    const hasCount = conteo.enteras > 0 || (conteo.abiertas && conteo.abiertas.some(a => a > 0));

    html += `<div class="bg-white rounded-xl p-3 shadow-md"
      style="border:1px solid ${hasCount ? 'rgba(48,209,88,0.30)' : 'var(--border)'};
             cursor:${myLocked ? 'default' : 'pointer'};"
      data-id="${escapeHtml(p.id)}"
      ${myLocked ? '' : `onclick="window.openInventarioModal(this.dataset.id)"`}>`;

    html += '<div class="flex items-center justify-between">';
    html += `<div style="flex:1;min-width:0;">
      <div style="font-weight:600;font-size:0.82rem;color:var(--txt-primary);
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(p.name)}
      </div>
      <div style="font-size:0.68rem;color:var(--txt-muted);margin-top:1px;">
        ${escapeHtml(p.group || 'General')} · ${escapeHtml(p.unit || '')}
      </div>
    </div>`;

    if (hasCount) {
      const abCnt = conteo.abiertas ? conteo.abiertas.filter(v => v > 0).length : 0;
      html += '<div style="flex-shrink:0;text-align:right;">';
      html += `<div style="font-size:0.75rem;font-weight:700;color:var(--green-text);">
        ${conteo.enteras} ent.`;
      if (abCnt > 0) html += ` + ${abCnt} ab.`;
      html += '</div>';
      if (!myLocked) {
        html += `<div style="font-size:0.60rem;color:var(--txt-muted);">toca para editar</div>`;
      }
      html += '</div>';
    } else {
      html += `<span style="font-size:0.75rem;color:var(--txt-muted);font-style:italic;">Sin contar</span>`;
    }
    html += '</div></div>';

    html += renderAuditTrailForProduct(p.id, area);
    html += '</div>';
  });
  html += '</div>';

  // Botón finalizar — solo si no está bloqueado
  if (!myLocked) {
    html += `<button onclick="window.auditoriaFinalizarConteo()" class="audit-finish-btn">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
      Finalizar conteo de ${areaLabel}
    </button>`;
  } else {
    html += `<button onclick="window.auditoriaVolverSeleccion()" class="audit-back-btn" style="width:100%;margin-top:16px;padding:12px;font-size:0.85rem;">
      ← Volver al panel de áreas
    </button>`;
  }

  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: HISTORIA — Con sección de Reportes Publicados
═══════════════════════════════════════════════════════════════ */
function renderHistoriaTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-4">';

  // ════════════════════════════════════════════════
  // 1. SECCIÓN DE REPORTES PUBLICADOS (todos los roles)
  // ════════════════════════════════════════════════
  html += `<div class="bg-white rounded-xl p-4 shadow-md">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <h3 style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);
                  letter-spacing:0.03em;text-transform:uppercase;">
        📊 Reportes de auditoría publicados
      </h3>`;

  if (isAdmin) {
    html += `<button onclick="window.openPublicarReporteModal()"
      style="padding:6px 12px;background:linear-gradient(135deg,#065f46,#047857);
             border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
             color:#86efac;font-size:0.72rem;font-weight:600;cursor:pointer;">
      📊 Publicar nuevo
    </button>`;
  }
  html += '</div>';
  html += renderReportesPublicados();
  html += '</div>';

  // ════════════════════════════════════════════════
  // 2. GUARDAR CONTEO ACTUAL (operativo)
  // ════════════════════════════════════════════════
  html += '<div class="bg-white rounded-xl p-4 shadow-md">';
  html += `<h3 style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);
                      letter-spacing:0.03em;text-transform:uppercase;margin-bottom:12px;">
    Guardar conteo actual
  </h3>`;

  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">';
  AREA_KEYS.forEach(area => {
    const isActive = state.selectedArea === area;
    html += `<button onclick="window.switchArea('${area}')"
      class="area-btn px-4 py-2 rounded-full text-sm font-semibold border transition-all"
      style="${isActive
        ? 'background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 2px 8px rgba(10,132,255,0.25);'
        : 'background:transparent;border-color:var(--border-mid);color:var(--txt-secondary);'}">
      ${AREAS[area]}
    </button>`;
  });
  html += '</div>';

  html += `<button onclick="window.saveInventory('${state.selectedArea}')"
    class="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-500
           text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
    </svg>
    💾 Guardar inventario de ${AREAS[state.selectedArea]}
  </button>`;
  html += '</div>';

  if (isAdmin) {
    html += `<div style="display:flex;gap:8px;">
      <button onclick="window.exportToExcel('INVENTARIO')"
        class="flex-1 py-2 bg-gradient-to-r from-green-600 to-emerald-600
               text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>Excel inventario
      </button>
      <button onclick="window.resetAllInventario()"
        class="flex-1 py-2 bg-gradient-to-r from-red-500 to-orange-500
               text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>Reset
      </button>
    </div>`;
  }

  // ════════════════════════════════════════════════
  // 3. HISTORIAL DE INVENTARIOS GUARDADOS
  // ════════════════════════════════════════════════
  if (state.inventories.length === 0) {
    html += `<div class="bg-white rounded-xl p-8 text-center shadow-md">
      <div style="font-size:2rem;margin-bottom:8px;">🗂</div>
      <p class="text-gray-500">No hay inventarios guardados</p>
    </div>`;
  } else {
    html += '<div class="space-y-3">';
    state.inventories.forEach((inv, idx) => {
      const delay = Math.min(idx * 50, 400);
      html += `<div class="bg-white rounded-xl p-4 shadow-md"
        style="animation:tabContentIn 0.3s ease-out ${delay}ms both">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div>
          <h3 style="font-weight:700;color:var(--txt-primary);font-size:0.875rem;">${escapeHtml(inv.id)}</h3>
          <p style="font-size:0.7rem;color:var(--txt-muted);margin-top:2px;">
            ${escapeHtml(inv.date)} · ${escapeHtml(AREAS[inv.area] || inv.area)}
          </p>
        </div>
        <div style="display:flex;gap:6px;">
          <button data-id="${escapeHtml(inv.id)}" onclick="window.shareInventoryWhatsApp(this.dataset.id)"
            class="p-2 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-lg" title="WhatsApp">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
            </svg></button>`;
      if (isAdmin) {
        html += `<button data-id="${escapeHtml(inv.id)}" onclick="window.deleteInventory(this.dataset.id)"
          class="p-2 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-lg" title="Eliminar">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg></button>`;
      }
      html += '</div></div>';
      html += `<p style="font-size:0.75rem;color:var(--txt-secondary);">
        Total: <strong style="color:var(--txt-primary);">${(inv.totalProducts || 0).toFixed(2)}</strong>
        · ${(inv.products || []).length} productos
      </p>`;
      html += '</div>';
    });
    html += '</div>';
  }

  // Toggle de sync
  const syncOn = state.syncEnabled !== false;
  html += `<div class="bg-white rounded-xl p-4 shadow-md">
    <h3 style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);margin-bottom:10px;letter-spacing:0.02em;">
      ⚙️ CONTROL DE SINCRONIZACIÓN
    </h3>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:0.8rem;font-weight:600;color:var(--txt-primary);">${syncOn ? '☁️ Sincronización activa' : '📴 Sincronización pausada'}</div>
        <div style="font-size:0.7rem;color:var(--txt-muted);margin-top:2px;">${syncOn ? 'Los datos se suben automáticamente a la nube.' : 'Los datos se guardan solo localmente.'}</div>
      </div>
      <button onclick="window.toggleSync()"
        style="padding:8px 16px;border-radius:100px;font-size:0.78rem;font-weight:700;cursor:pointer;
               background:${syncOn ? 'var(--red-dim)' : 'var(--accent-dim)'};
               border:1px solid ${syncOn ? 'rgba(255,69,58,.22)' : 'var(--accent-dim2)'};
               color:${syncOn ? 'var(--red-text)' : 'var(--accent)'};">
        ${syncOn ? '⏸ Pausar' : '▶ Activar'}
      </button>
    </div>
  </div>`;

  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: NOTIFICACIONES
═══════════════════════════════════════════════════════════════ */
function renderNotificacionesTab() {
  let html = '<div class="space-y-3">';
  html += renderNotificacionesPanel();
  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: AJUSTES
═══════════════════════════════════════════════════════════════ */
function renderAjustesTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-3">';

  if (isAdmin) {
    const count = state.ajustesPendientes?.length || 0;
    html += `<div class="bg-white rounded-xl p-4 shadow-md">
      <h3 style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);
                 letter-spacing:0.02em;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        🔧 AJUSTES PENDIENTES
        ${count > 0
          ? `<span style="background:var(--red);color:#fff;border-radius:100px;padding:1px 8px;font-size:0.60rem;font-weight:700;">${count}</span>`
          : ''}
      </h3>
      ${renderAjustesPendientesPanel()}
    </div>`;
  } else {
    const pending = state.adjustmentsPending || [];
    html += '<div class="bg-white rounded-xl p-4 shadow-md">';
    html += `<h3 style="font-size:0.8rem;font-weight:700;color:var(--txt-primary);
                        letter-spacing:0.02em;margin-bottom:10px;">📤 MIS AJUSTES ENVIADOS</h3>`;
    if (pending.length === 0) {
      html += `<p style="font-size:0.78rem;color:var(--txt-muted);">Sin ajustes pendientes</p>`;
    } else {
      pending.forEach(a => {
        html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
                              padding:9px 12px;margin-bottom:6px;font-size:0.75rem;color:var(--txt-secondary);">
          <strong style="color:var(--txt-primary);">${escapeHtml(a.productoName)}</strong>
          · ${escapeHtml(a.campoLabel)}: ${escapeHtml(a.valorAnterior || '—')} → ${escapeHtml(a.valorNuevo)}
          <span style="margin-left:6px;font-size:0.65rem;color:var(--amber);">⏳ Pendiente de subir</span>
        </div>`;
      });
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ── Bindings globales ── */
window.switchTab = switchTab;
window.renderTab = renderTab;
