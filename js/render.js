/**
 * js/render.js — Motor de renderizado rediseñado (UI Nativa Corporativa)
 * No se ha modificado la lógica de negocio, solo las clases visuales.
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
  auditoriaTodasCompletas
} from './audit.js';
import { renderNotificacionesPanel } from './notificaciones.js';
import { renderAjustesPendientesPanel } from './ajustes.js';
import { renderReportesPublicados } from './reportes.js';

/* ── Utilidad de scroll/foco ── */
function _getElementSelector(el) {
  if (!el || el === document.body) return null;
  if (el.id) return '#' + el.id;
  if (el.tagName === 'INPUT' && el.placeholder === 'Buscar...')
    return '#tabContent input[placeholder="Buscar..."]';
  const parent = el.closest('[data-render-key]');
  if (parent)
    return '[data-render-key="' + parent.dataset.renderKey + '"] ' + el.tagName.toLowerCase();
  return null;
}

/* ── Punto de entrada principal ── */
export function renderTab() {
  updateHeaderActions();
  const content = document.getElementById('tabContent');
  if (!content) return;

  const scrollY = window.scrollY || window.pageYOffset;
  const focused = document.activeElement;
  const focusedSelector = _getElementSelector(focused);
  const cursorPos = (focused && focused.selectionStart !== undefined)
                     ? focused.selectionStart : null;
  const focusedValue = (focused && focused.tagName === 'INPUT')
                       ? focused.value : null;

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
  saveToLocalStorage();
  renderTab();
  // Actualizar también la bottom navigation
  updateBottomNavActive(tab);
}

/* ── Helper para actualizar la barra inferior ── */
function updateBottomNavActive(tab) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.dataset.navTab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/* ── Helper stat card (versión premium) ── */
function _statCard(emoji, label, value, color) {
  return `<div class="card-premium text-center" style="flex:1;">
    <div style="font-size:28px; margin-bottom:6px;">${emoji}</div>
    <div style="font-size:13px; color:var(--text-tertiary);">${label}</div>
    <div style="font-size:24px; font-weight:700; color:${color};">${value}</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: INICIO (Rediseñado con cards)
═══════════════════════════════════════════════════════════════ */
function renderInicioTab() {
  const isAdmin = state.userRole === 'admin';
  const roleLoading = state.userRole === null;
  const filtered = filterByGroup();
  const groups = getAvailableGroups();
  const totalProducts = state.products.length;
  const totalStock = state.products.reduce((s, p) => s + getTotalStock(p), 0);

  let html = '<div class="space-y-4">';

  /* ── Stats Grid ── */
  html += '<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">';
  html += _statCard('📦', 'Productos', totalProducts, 'var(--accent)');
  html += _statCard('📊', 'Stock total', totalStock.toFixed(1), 'var(--success)');
  html += _statCard('🛒', 'En carrito',
    state.cart.reduce((s, i) => s + i.quantity, 0).toFixed(1), 'var(--warning)');
  html += _statCard('📋', 'Pedidos', state.orders.length, 'var(--accent)');
  html += '</div>';

  /* ── Barra de filtros ── */
  html += '<div class="card-premium flex flex-wrap gap-2 items-center">';
  html += `<input type="text" placeholder="Buscar productos..."
    value="${escapeHtml(state.searchTerm)}"
    oninput="window.updateSearchTerm(this.value)"
    class="input-field flex-1 min-w-[120px]" style="padding:12px;">`;
  html += `<select onchange="window.updateSelectedGroup(this.value)"
    class="input-field w-auto flex-shrink-0">`;
  groups.forEach(g => {
    html += `<option value="${escapeHtml(g)}"${state.selectedGroup === g ? ' selected' : ''}>
      ${escapeHtml(g)}</option>`;
  });
  html += '</select>';

  if (isAdmin) {
    html += `<button onclick="window.openProductModal()"
      class="btn btn-primary">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
      Producto
    </button>`;
    html += `<button onclick="document.getElementById('fileInput').click();"
      class="btn btn-secondary">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
      Importar
    </button>`;
  } else if (roleLoading) {
    html += `<span class="text-tertiary text-sm">⏳ Verificando...</span>`;
  }
  html += '</div>';

  /* ── Lista de productos (Cards) ── */
  if (filtered.length === 0) {
    html += '<div class="card-premium text-center py-8"><p class="text-tertiary">No hay productos que mostrar</p></div>';
  } else {
    html += '<div class="product-grid">';
    filtered.forEach((p, idx) => {
      const total = getTotalStock(p);
      const delay = Math.min(idx * 30, 300);
      html += `<div class="product-card" style="animation: slideUp 0.3s ease-out ${delay}ms both;">`;
      
      /* Header producto */
      html += '<div class="product-info">';
      html += `<div><div class="product-name">${escapeHtml(p.name)}</div>`;
      html += `<div class="product-meta">${escapeHtml(p.id)} · ${escapeHtml(p.unit || 'Unidad')}</div></div>`;
      html += `<div class="font-bold text-accent text-lg">${total.toFixed(2)}</div>`;
      html += '</div>';
      
      /* Stock por áreas */
      html += '<div class="product-stats flex-wrap">';
      AREA_KEYS.forEach(area => {
        const val = p.stockByArea && p.stockByArea[area] !== undefined ? p.stockByArea[area] : 0;
        html += `<span class="stat-badge">${AREAS[area]}: ${val.toFixed(2)}</span>`;
      });
      html += '</div>';
      
      /* Botones de acción */
      html += '<div class="flex gap-2 mt-3">';
      html += `<button data-id="${escapeHtml(p.id)}" onclick="window.addToCart(this.dataset.id)" class="btn btn-primary flex-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg> Agregar</button>`;
      
      if (!isAdmin) {
        html += `<button data-id="${escapeHtml(p.id)}" onclick="window.openAjusteModal(this.dataset.id)" class="btn btn-secondary"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg> Ajuste</button>`;
      }
      if (isAdmin) {
        html += `<button data-id="${escapeHtml(p.id)}" onclick="window.editProduct(this.dataset.id)" class="btn btn-secondary"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>`;
        html += `<button data-id="${escapeHtml(p.id)}" onclick="window.deleteProduct(this.dataset.id)" class="btn btn-danger"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`;
      }
      html += '</div></div>';
    });
    html += '</div>';
  }

  if (isAdmin && state.products.length > 0) {
    html += `<button onclick="window.deleteAllProducts()" class="btn btn-danger btn-block mt-4">Eliminar todos los productos</button>`;
  }
  html += '</div>';
  return html;
}

/* TAB: PRODUCTOS (alias de inicio) */
function renderProductosTab() { return renderInicioTab(); }

/* TAB: PEDIDOS (Rediseñado) */
function renderPedidosTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-4">';
  html += `<div class="card-premium"><div class="card-header"><span class="card-title">📱 Pedidos por WhatsApp</span><span class="card-badge">Local</span></div>`;
  if (state.orders.length === 0) {
    html += '<div class="text-center py-8"><div style="font-size:48px;">🛒</div><p class="text-tertiary mt-2">No hay pedidos todavía</p><p class="text-xs text-quaternary">Ve a Inicio y agrega productos al carrito</p></div>';
  } else {
    state.orders.forEach(order => {
      html += `<div class="border-t border-subtle pt-3 mt-3 first:border-0 first:pt-0 first:mt-0">`;
      html += `<div class="flex justify-between items-start"><div><h3 class="font-semibold">${escapeHtml(order.id)}</h3><p class="text-tertiary text-sm">Proveedor: ${escapeHtml(order.supplier)}</p><p class="text-quaternary text-xs">${escapeHtml(order.date)}</p></div>`;
      html += `<div class="flex gap-2"><button data-id="${escapeHtml(order.id)}" onclick="window.shareOrderWhatsApp(this.dataset.id)" class="btn btn-success btn-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg></button>`;
      if (isAdmin) html += `<button data-id="${escapeHtml(order.id)}" onclick="window.deleteOrder(this.dataset.id)" class="btn btn-danger btn-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`;
      html += `</div></div>`;
      html += `<div class="mt-2"><div class="text-sm font-medium">Productos:</div>`;
      order.products.forEach(p => {
        html += `<div class="flex justify-between text-sm py-1"><span>${escapeHtml(p.name)}</span><span>${p.quantity} ${escapeHtml(p.unit)}</span></div>`;
      });
      html += `<div class="text-right font-bold mt-2">Total: ${(order.total || 0).toFixed(2)}</div>`;
      if (order.note) html += `<div class="mt-2 p-2 bg-surface rounded-md text-tertiary text-sm">📝 ${escapeHtml(order.note)}</div>`;
      html += `</div></div>`;
    });
  }
  html += '</div></div>';
  return html;
}

/* TAB: INVENTARIO (Auditoría) */
function renderInventarioTab() {
  if (state.auditoriaView === 'counting' && state.auditoriaAreaActiva)
    return renderAuditoriaConteo();
  return renderAuditoriaSeleccion();
}

function renderAuditoriaSeleccion() {
  const isAdmin = state.userRole === 'admin';
  const totalCompletas = auditoriaTotalAreasCompletadas();
  const porcentaje = Math.round((totalCompletas / 3) * 100);
  const todasCompletas = auditoriaTodasCompletas();
  let html = '<div class="space-y-4">';
  html += `<div class="card-premium"><div class="card-header"><span class="card-title">📋 Auditoría Física Ciega</span><span class="card-badge">${totalCompletas}/3 áreas</span></div>`;
  html += `<div class="h-1.5 bg-surface rounded-full overflow-hidden"><div class="h-full bg-accent rounded-full" style="width:${porcentaje}%"></div></div>`;
  html += renderAuditUserPanel();
  html += renderAuditComparePanel();
  html += `<div class="space-y-3 mt-4">`;
  ['almacen', 'barra1', 'barra2'].forEach(area => {
    const isCompleta = state.auditoriaStatus[area] === 'completada';
    html += `<div class="card-premium flex items-center justify-between cursor-pointer" onclick="window.auditoriaEntrarArea('${area}')">`;
    html += `<div><div class="font-semibold">${AREAS_AUDITORIA[area]}</div><span class="text-xs text-tertiary">${isCompleta ? '✓ Completada' : '⏳ Pendiente'}</span></div>`;
    html += `<svg class="w-5 h-5 text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;
    html += `</div>`;
  });
  html += `</div>`;
  if (todasCompletas && isAdmin) {
    html += `<button onclick="window.exportarAuditoriaExcel()" class="btn btn-success btn-block mt-4">📊 Exportar Auditoría a Excel</button>`;
  }
  html += `</div></div>`;
  return html;
}

function renderAuditoriaConteo() {
  const area = state.auditoriaAreaActiva;
  const areaLabel = AREAS_AUDITORIA[area];
  const filtered = filterByGroup();
  const _invGroups = getAvailableGroups();
  let html = '<div class="space-y-4">';
  html += `<div class="card-premium sticky top-0 z-10"><div class="flex items-center gap-3"><button onclick="window.auditoriaVolverSeleccion()" class="btn btn-secondary btn-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 19l-7-7 7-7"/></svg></button><span class="card-badge">${areaLabel}</span></div>`;
  html += `<div class="flex gap-2 mt-3"><input type="text" placeholder="Buscar..." value="${escapeHtml(state.searchTerm)}" oninput="window.updateSearchTerm(this.value)" class="input-field flex-1"><select onchange="window.updateSelectedGroup(this.value)" class="input-field w-auto">${_invGroups.map(g => `<option value="${escapeHtml(g)}"${state.selectedGroup === g ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}</select></div></div>`;
  html += '<div class="space-y-3">';
  filtered.forEach(p => {
    const conteo = state.auditoriaConteo[p.id]?.[area] || { enteras: 0, abiertas: [] };
    const hasCount = conteo.enteras > 0 || (conteo.abiertas && conteo.abiertas.some(a => a > 0));
    html += `<div class="card-premium cursor-pointer" data-id="${escapeHtml(p.id)}" onclick="window.openInventarioModal(this.dataset.id)">`;
    html += `<div class="flex justify-between"><div><div class="font-semibold">${escapeHtml(p.name)}</div><div class="text-tertiary text-xs">${escapeHtml(p.group || 'General')}</div></div>`;
    if (hasCount) html += `<div class="text-right"><div class="text-success font-bold">${conteo.enteras} ent.</div>${conteo.abiertas && conteo.abiertas.some(a => a > 0) ? `<div class="text-warning text-xs">+ ${conteo.abiertas.filter(a => a > 0).length} ab.</div>` : ''}</div>`;
    else html += `<span class="text-tertiary text-sm italic">Sin contar</span>`;
    html += `</div>${renderAuditTrailForProduct(p.id, area)}</div>`;
  });
  html += `</div><button onclick="window.auditoriaFinalizarConteo()" class="btn btn-primary btn-block mt-4">✅ Finalizar conteo de ${areaLabel}</button></div>`;
  return html;
}

/* TAB: HISTORIA */
function renderHistoriaTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-4">';
  html += `<div class="card-premium"><div class="card-header"><span class="card-title">💾 Guardar inventario</span></div><div class="flex gap-2 flex-wrap mb-3">`;
  AREA_KEYS.forEach(area => {
    const isActive = state.selectedArea === area;
    html += `<button onclick="window.switchArea('${area}')" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} flex-1">${AREAS[area]}</button>`;
  });
  html += `</div><button onclick="window.saveInventory('${state.selectedArea}')" class="btn btn-primary btn-block">💾 Guardar inventario de ${AREAS[state.selectedArea]}</button></div>`;
  if (isAdmin) {
    html += `<div class="flex gap-2"><button onclick="window.exportToExcel('INVENTARIO')" class="btn btn-success flex-1">📊 Excel</button><button onclick="window.resetAllInventario()" class="btn btn-danger flex-1">🗑 Reset</button></div>`;
  }
  if (state.inventories.length === 0) {
    html += '<div class="card-premium text-center py-8"><p class="text-tertiary">No hay inventarios guardados</p></div>';
  } else {
    state.inventories.forEach(inv => {
      html += `<div class="card-premium"><div class="flex justify-between"><div><h3 class="font-semibold">${escapeHtml(inv.id)}</h3><p class="text-tertiary text-xs">${escapeHtml(inv.date)} · ${escapeHtml(AREAS[inv.area] || inv.area)}</p></div>`;
      html += `<div class="flex gap-2"><button data-id="${escapeHtml(inv.id)}" onclick="window.shareInventoryWhatsApp(this.dataset.id)" class="btn btn-success btn-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg></button>`;
      if (isAdmin) html += `<button data-id="${escapeHtml(inv.id)}" onclick="window.deleteInventory(this.dataset.id)" class="btn btn-danger btn-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`;
      html += `</div></div><div class="mt-2 text-tertiary text-sm">Total: <strong>${(inv.totalProducts || 0).toFixed(2)}</strong> · ${(inv.products || []).length} productos</div></div>`;
    });
  }
  const syncOn = state.syncEnabled !== false;
  html += `<div class="card-premium"><div class="card-header"><span class="card-title">⚙️ Control de sincronización</span></div><div class="flex justify-between items-center"><div><div class="font-medium">${syncOn ? '☁️ Sincronización activa' : '📴 Sincronización pausada'}</div><div class="text-tertiary text-xs">${syncOn ? 'Los datos se suben automáticamente' : 'Los datos se guardan solo localmente'}</div></div><button onclick="window.toggleSync()" class="btn ${syncOn ? 'btn-danger' : 'btn-primary'}">${syncOn ? '⏸ Pausar' : '▶ Activar'}</button></div></div>`;
  html += `<div class="card-premium"><div class="card-header"><span class="card-title">📊 Reportes publicados</span></div>`;
  if (isAdmin) {
    html += `<button onclick="window.openPublicarReporteModal()" class="btn btn-success btn-block mb-3">📊 Generar y publicar reporte final</button>`;
  }
  html += renderReportesPublicados();
  html += `</div></div>`;
  return html;
}

/* TAB: NOTIFICACIONES */
function renderNotificacionesTab() {
  return `<div class="space-y-3">${renderNotificacionesPanel()}</div>`;
}

/* TAB: AJUSTES */
function renderAjustesTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-3">';
  if (isAdmin) {
    const count = state.ajustesPendientes?.length || 0;
    html += `<div class="card-premium"><div class="card-header"><span class="card-title">🔧 Ajustes pendientes ${count > 0 ? `<span class="card-badge">${count}</span>` : ''}</span></div>${renderAjustesPendientesPanel()}</div>`;
  } else {
    const pending = state.adjustmentsPending || [];
    html += `<div class="card-premium"><div class="card-header"><span class="card-title">📤 Mis ajustes enviados</span></div>`;
    if (pending.length === 0) html += '<p class="text-tertiary text-center py-4">Sin ajustes pendientes</p>';
    else pending.forEach(a => {
      html += `<div class="border-t border-subtle first:border-0 pt-2 first:pt-0 mt-2 first:mt-0"><div class="flex justify-between"><span class="font-medium">${escapeHtml(a.productoName)}</span><span class="text-tertiary text-xs">${escapeHtml(a.campoLabel)}</span></div><div class="text-sm">${escapeHtml(a.valorAnterior || '—')} → <span class="text-accent">${escapeHtml(a.valorNuevo)}</span></div><div class="text-warning text-xs mt-1">⏳ Pendiente de subir</div></div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/* Bindings globales para mantener compatibilidad */
window.switchTab = switchTab;
window.renderTab = renderTab;
