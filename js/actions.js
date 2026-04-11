/**
 * js/actions.js — v2.4 CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * Implementa y expone en window TODAS las funciones de acción
 * llamadas desde los onclick del HTML generado por render.js
 * y desde el index.html estático.
 *
 * CORRECCIONES v2.4:
 * ──────────────────────────────────────────────────────────────
 * BUG PRINCIPAL — Botellas abiertas nunca aparecían:
 *
 *   index.html tiene un modal estático (#inventarioModal) con:
 *     • #inv_enteras           — input botellas enteras
 *     • #inv_abiertasContainer — lista de inputs de oz
 *     • addAbiertaInModal()    — botón "+ Agregar"
 *     • saveInventarioModal()  — botón "Guardar conteo"
 *     • closeInventarioModal() — botón "Cancelar"
 *
 *   Pero actions.js IGNORABA ese modal y creaba su propio
 *   overlay simple (solo un input numérico, sin abiertas).
 *   Además, addAbiertaInModal/saveInventarioModal/closeInventarioModal
 *   nunca estaban definidas → al hacer clic en "+ Agregar"
 *   no pasaba absolutamente nada.
 *
 *   CORRECCIÓN:
 *   • openInventarioModal() ahora USA el modal estático del HTML.
 *   • Se implementan addAbiertaInModal(), closeInventarioModal(),
 *     saveInventarioModal() como funciones window.*.
 *   • Al guardar: actualiza stockByArea, inventarioConteo Y
 *     auditoriaConteo ({ enteras, abiertas:[oz...] }).
 *
 * BUG 2 — exportFullData no existía:
 *   El sidebar llama exportFullData() que nunca estaba definida.
 *   CORRECCIÓN: Implementada y expuesta en window.
 *
 * BUG 3 (v2.3) — auditoriaConteo no se actualizaba en modal.
 * BUG 4 (v2.2) — AREA_KEYS importado del módulo incorrecto.
 * ══════════════════════════════════════════════════════════════
 */

import { state }                    from './state.js';
import { saveToLocalStorage }       from './storage.js';
import { showNotification,
         showConfirm,
         escapeHtml }               from './ui.js';
import { deleteProduct as _deleteProduct,
         addProduct,
         updateProduct,
         calcularStockTotal }       from './products.js';
import { AREAS,
         AREA_KEYS }                from './constants.js';

// ── Lazy import de render para evitar circularidad ─────────────
const _render = () => import('./render.js').then(m => m.renderTab()).catch(() => {});

// ── Estado interno del modal de inventario ────────────────────
let _invProductId = null;
let _invArea      = null;

// ═════════════════════════════════════════════════════════════
//  PRODUCTOS — Modal de alta / edición
// ═════════════════════════════════════════════════════════════

function openProductModal(productId = null) {
    if (state.userRole !== 'admin') {
        showNotification('⛔ Solo el administrador puede modificar productos');
        return;
    }

    const isEdit  = !!productId;
    const product = isEdit ? state.products.find(p => p.id === productId) : null;

    if (isEdit && !product) {
        showNotification('⚠️ Producto no encontrado');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = '_productModalOverlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;' +
        'animation:fadeIn 0.15s ease both;';

    overlay.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border-mid);
                  border-radius:var(--r-lg);padding:24px 24px 20px;
                  max-width:400px;width:92%;box-shadow:var(--shadow-modal);
                  max-height:90vh;overflow-y:auto;">
        <p style="font-weight:700;font-size:0.95rem;color:var(--txt-primary);margin:0 0 16px;">
          ${isEdit ? '✏️ Editar producto' : '➕ Nuevo producto'}
        </p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;font-size:0.7rem;font-weight:700;
                          text-transform:uppercase;letter-spacing:.07em;
                          color:var(--txt-secondary);margin-bottom:4px;">Nombre *</label>
            <input id="_pm_name" type="text" value="${escapeHtml(product?.name || '')}"
              placeholder="Ej: Bacardí Blanco"
              style="width:100%;box-sizing:border-box;padding:8px 10px;
                     background:var(--surface);border:1px solid var(--border-mid);
                     border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">Unidad</label>
              <input id="_pm_unit" type="text" value="${escapeHtml(product?.unit || 'Botella')}"
                placeholder="Botella, Caja…"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">Grupo / Categoría</label>
              <input id="_pm_group" type="text" value="${escapeHtml(product?.group || 'Destilados')}"
                placeholder="Destilados, Cervezas…"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">Capacidad (mL)</label>
              <input id="_pm_capacidad" type="number" min="0" step="1"
                value="${product?.capacidadMl || ''}" placeholder="750"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">Peso lleno (oz)</label>
              <input id="_pm_peso" type="number" min="0" step="0.1"
                value="${product?.pesoBotellaLlenaOz || ''}" placeholder="55.0"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;">
          <button id="_pm_cancel"
            style="flex:1;padding:9px;border-radius:var(--r-md);
                   background:var(--surface);border:1px solid var(--border-mid);
                   color:var(--txt-secondary);font-size:0.82rem;cursor:pointer;">Cancelar</button>
          <button id="_pm_save"
            style="flex:2;padding:9px;border-radius:var(--r-md);
                   background:linear-gradient(135deg,#8b5cf6,#3b82f6);
                   border:none;color:#fff;font-size:0.82rem;font-weight:700;cursor:pointer;">
            ${isEdit ? 'Guardar cambios' : 'Agregar producto'}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#_pm_cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_pm_save').addEventListener('click', () => {
        const name      = (overlay.querySelector('#_pm_name').value || '').trim();
        const unit      = (overlay.querySelector('#_pm_unit').value || 'Botella').trim();
        const group     = (overlay.querySelector('#_pm_group').value || 'General').trim();
        const capacidad = parseFloat(overlay.querySelector('#_pm_capacidad').value) || null;
        const peso      = parseFloat(overlay.querySelector('#_pm_peso').value) || null;

        if (!name) { showNotification('⚠️ El nombre del producto es obligatorio'); return; }

        if (isEdit) {
            updateProduct(productId, { name, unit, group, capacidadMl: capacidad, pesoBotellaLlenaOz: peso });
        } else {
            addProduct({ name, unit, group, capacidadMl: capacidad, pesoBotellaLlenaOz: peso });
        }
        close();
        _render();
        if (state.syncEnabled && window._db) {
            import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
        }
    });
    setTimeout(() => overlay.querySelector('#_pm_name')?.focus(), 50);
}

function editProduct(id) { openProductModal(id); }

async function deleteProduct(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }
    const ok = await showConfirm(`¿Eliminar "${product.name}"?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    _deleteProduct(id);
    _render();
    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

async function deleteAllProducts() {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm('¿Eliminar TODOS los productos?\n\nSe borrará el catálogo completo. No se puede deshacer.');
    if (!ok) return;
    state.products = [];
    state.inventarioConteo = {};
    state.auditoriaConteo = {};
    state.auditoriaConteoPorUsuario = {};
    saveToLocalStorage();
    showNotification('🗑️ Todos los productos eliminados');
    _render();
    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

// ═════════════════════════════════════════════════════════════
//  CARRITO
// ═════════════════════════════════════════════════════════════

function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }
    const existing = state.cart.find(i => i.id === productId);
    if (existing) {
        existing.quantity += 1;
        showNotification(`🛒 ${product.name} → ${existing.quantity}`);
    } else {
        state.cart.push({ id: product.id, name: product.name, unit: product.unit || 'Unidad', quantity: 1 });
        showNotification(`🛒 ${product.name} agregado al carrito`);
    }
    saveToLocalStorage();
    _render();
}

// ═════════════════════════════════════════════════════════════
//  PEDIDOS
// ═════════════════════════════════════════════════════════════

function shareOrderWhatsApp(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) { showNotification('⚠️ Pedido no encontrado'); return; }
    const lines = [
        `📦 *Pedido ${order.id}*`, `Proveedor: ${order.supplier || '—'}`,
        `Fecha: ${order.date || '—'}`, '',
        '*Productos:*',
        ...(order.products || []).map(p => `• ${p.name} (${p.unit || 'Unid'}): *${p.quantity}*`),
        '', order.note ? `📝 ${order.note}` : null,
    ].filter(l => l !== null).join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

async function deleteOrder(orderId) {
    const ok = await showConfirm('¿Eliminar este pedido?\n\nNo se puede deshacer.');
    if (!ok) return;
    state.orders = state.orders.filter(o => o.id !== orderId);
    saveToLocalStorage();
    showNotification('🗑️ Pedido eliminado');
    _render();
}

// ═════════════════════════════════════════════════════════════
//  INVENTARIO
// ═════════════════════════════════════════════════════════════

function switchArea(area) {
    state.selectedArea = area;
    _render();
}

function saveInventory(area) {
    if (!area) area = state.selectedArea;
    const conStock = state.products.filter(p => p.stockByArea?.[area] > 0);
    if (conStock.length === 0) { showNotification('⚠️ No hay conteo en esta área para guardar'); return; }

    const snapshot = {
        id:            'INV-' + Date.now(),
        date:          new Date().toLocaleDateString('es-MX'),
        area,
        usuario:       state.currentUser?.email || state.auditCurrentUser?.userName || 'Sistema',
        totalProducts: state.products.reduce((s, p) => s + (p.stockByArea?.[area] || 0), 0),
        products:      state.products
            .filter(p => p.stockByArea?.[area] > 0)
            .map(p => ({ id: p.id, name: p.name, unit: p.unit, group: p.group, stock: p.stockByArea?.[area] || 0 })),
    };

    state.inventories.unshift(snapshot);
    if (state.inventories.length > 50) state.inventories.pop();
    saveToLocalStorage();
    showNotification(`💾 Inventario de ${AREAS[area] || area} guardado`);
    _render();
    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

function shareInventoryWhatsApp(inventoryId) {
    const inv = state.inventories.find(i => i.id === inventoryId);
    if (!inv) { showNotification('⚠️ Inventario no encontrado'); return; }
    const lines = [
        `📊 *Inventario ${inv.id}*`, `Área: ${AREAS[inv.area] || inv.area || '—'}`,
        `Fecha: ${inv.date || '—'}`, `Usuario: ${inv.usuario || '—'}`, '',
        '*Productos:*',
        ...(inv.products || []).map(p => `• ${p.name}: *${(p.stock||0).toFixed(2)}* ${p.unit||''}`),
        '', `Total unidades: *${(inv.totalProducts || 0).toFixed(2)}*`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

async function deleteInventory(inventoryId) {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm('¿Eliminar este registro de inventario?\n\nNo se puede deshacer.');
    if (!ok) return;
    state.inventories = state.inventories.filter(i => i.id !== inventoryId);
    saveToLocalStorage();
    showNotification('🗑️ Registro eliminado');
    _render();
}

async function resetAllInventario() {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm('¿Resetear TODO el inventario?\n\nSe pondrán en cero todos los conteos. No se puede deshacer.');
    if (!ok) return;
    state.inventarioConteo = {};
    state.products.forEach(p => { p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 }; });
    saveToLocalStorage();
    showNotification('🔄 Inventario reseteado a cero');
    _render();
    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

// ═════════════════════════════════════════════════════════════
//  MODAL DE INVENTARIO — Botellas Enteras + Abiertas
//  FIX v2.4: Conecta con el modal estático #inventarioModal
//  de index.html e implementa las 3 funciones que el HTML llama.
// ═════════════════════════════════════════════════════════════

/**
 * openInventarioModal(productId)
 *
 * ANTES: creaba overlay dinámico simple sin sección de abiertas.
 * AHORA: muestra el modal estático #inventarioModal del HTML,
 *        lo pre-llena con los datos actuales y activa la sección
 *        de botellas abiertas con oz inputs dinámicos.
 */
function openInventarioModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const area  = state.selectedArea || 'almacen';
    const modal = document.getElementById('inventarioModal');

    // Sin modal estático: usar overlay dinámico de fallback
    if (!modal) {
        _openInventarioFallback(productId, area, product);
        return;
    }

    // Guardar referencia para save/close
    _invProductId = productId;
    _invArea      = area;

    // Título y subtítulo
    const titleEl    = document.getElementById('inventarioModalTitle');
    const subtitleEl = document.getElementById('inventarioModalSubtitle');
    const hintEl     = document.getElementById('inv_abiertasUnidadHint');

    if (titleEl)    titleEl.textContent    = product.name;
    if (subtitleEl) subtitleEl.textContent = `Área: ${AREAS[area] || area}`;
    if (hintEl) {
        hintEl.textContent = product.pesoBotellaLlenaOz
            ? `(oz — llena: ${product.pesoBotellaLlenaOz} oz)`
            : '(oz)';
    }

    // Pre-llenar botellas enteras con el conteo actual
    const enterasInput = document.getElementById('inv_enteras');
    if (enterasInput) {
        const currentEnteras =
            state.auditoriaConteo[productId]?.[area]?.enteras ??
            state.inventarioConteo[productId]?.[area] ??
            product.stockByArea?.[area] ?? 0;
        enterasInput.value = String(currentEnteras);
    }

    // Pre-llenar botellas abiertas existentes
    const container = document.getElementById('inv_abiertasContainer');
    if (container) {
        container.innerHTML = '';
        const abiertas = state.auditoriaConteo[productId]?.[area]?.abiertas ?? [];
        abiertas.forEach(oz => _addAbiertaRow(container, oz));
    }

    // Mostrar modal
    modal.classList.remove('hidden');
    setTimeout(() => { enterasInput?.focus(); enterasInput?.select(); }, 60);
}

/**
 * _addAbiertaRow(container, valorOz)
 * Agrega una fila de peso oz al contenedor de botellas abiertas.
 */
function _addAbiertaRow(container, valorOz = '') {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';
    row.innerHTML = `
        <input type="number" min="0" step="0.1" value="${valorOz}"
            placeholder="Peso actual (oz)"
            style="flex:1;padding:8px 10px;background:var(--surface);
                   border:2px solid #f97316;border-radius:6px;
                   color:var(--txt-primary);font-size:0.9rem;text-align:center;"
            oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value='';">
        <button type="button"
            onclick="this.parentElement.remove()"
            style="width:30px;height:30px;flex-shrink:0;border-radius:50%;
                   border:none;background:#fee2e2;color:#dc2626;
                   font-size:0.75rem;cursor:pointer;">✕</button>`;
    container.appendChild(row);
    row.querySelector('input')?.focus();
}

/**
 * addAbiertaInModal()
 * FIX: Era llamada desde index.html pero NUNCA estaba definida.
 * Llamada por el botón "+ Agregar" del modal estático.
 */
function addAbiertaInModal() {
    const container = document.getElementById('inv_abiertasContainer');
    if (container) _addAbiertaRow(container);
}

/**
 * closeInventarioModal()
 * FIX: Era llamada desde index.html pero NUNCA estaba definida.
 * Llamada por el botón "Cancelar" del modal estático.
 */
function closeInventarioModal() {
    const modal = document.getElementById('inventarioModal');
    if (modal) modal.classList.add('hidden');
    _invProductId = null;
    _invArea      = null;
}

/**
 * saveInventarioModal()
 * FIX: Era llamada desde index.html pero NUNCA estaba definida.
 * Llamada por el botón "Guardar conteo" del modal estático.
 * Guarda enteras + abiertas en auditoriaConteo e inventarioConteo.
 */
function saveInventarioModal() {
    if (!_invProductId || !_invArea) { closeInventarioModal(); return; }

    const productId = _invProductId;
    const area      = _invArea;
    const product   = state.products.find(p => p.id === productId);
    if (!product) { closeInventarioModal(); return; }

    // Leer botellas enteras
    const enterasInput = document.getElementById('inv_enteras');
    const enteras = Math.max(0, parseFloat(enterasInput?.value) || 0);

    // Leer botellas abiertas (array de pesos en oz)
    const container = document.getElementById('inv_abiertasContainer');
    const abiertas  = [];
    if (container) {
        container.querySelectorAll('input[type="number"]').forEach(inp => {
            const val = parseFloat(inp.value);
            if (!isNaN(val) && val > 0) abiertas.push(val);
        });
    }

    // ── Guardar en auditoriaConteo { enteras, abiertas:[oz...] } ─
    if (!state.auditoriaConteo[productId])       state.auditoriaConteo[productId] = {};
    state.auditoriaConteo[productId][area] = { enteras, abiertas };

    // ── Guardar en inventarioConteo (número plano para stockByArea) ─
    if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
    state.inventarioConteo[productId][area] = enteras;

    // ── Actualizar stockByArea ────────────────────────────────────
    if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    product.stockByArea[area] = enteras;

    saveToLocalStorage();

    const totalText = abiertas.length > 0
        ? `${enteras} ent. + ${abiertas.length} ab.`
        : `${enteras} uds`;
    showNotification(`✅ ${product.name}: ${totalText} en ${AREAS[area] || area}`);

    closeInventarioModal();
    _render();

    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

/**
 * Fallback: overlay dinámico si el modal estático no existe en el DOM.
 */
function _openInventarioFallback(productId, area, product) {
    const current = product.stockByArea?.[area] || 0;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border-mid);border-radius:var(--r-lg);padding:24px;max-width:320px;width:90%;box-shadow:var(--shadow-modal);">
        <p style="font-weight:700;font-size:0.9rem;color:var(--txt-primary);margin:0 0 4px;">📦 ${escapeHtml(product.name)}</p>
        <p style="font-size:0.72rem;color:var(--txt-muted);margin:0 0 16px;">Área: ${AREAS[area] || area}</p>
        <input id="_inv_qty_fb" type="number" min="0" step="0.5" value="${current}"
          style="width:100%;box-sizing:border-box;padding:10px;font-size:1.1rem;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-md);color:var(--txt-primary);text-align:center;">
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button id="_inv_cancel_fb" style="flex:1;padding:9px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--border-mid);color:var(--txt-secondary);cursor:pointer;">Cancelar</button>
          <button id="_inv_save_fb" style="flex:2;padding:9px;border-radius:var(--r-md);background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;color:#fff;font-weight:700;cursor:pointer;">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#_inv_cancel_fb').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#_inv_save_fb').addEventListener('click', () => {
        const qty = parseFloat(overlay.querySelector('#_inv_qty_fb').value);
        if (isNaN(qty) || qty < 0) { showNotification('⚠️ Valor inválido'); return; }
        if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
        product.stockByArea[area] = qty;
        if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
        state.inventarioConteo[productId][area] = qty;
        if (!state.auditoriaConteo[productId]) state.auditoriaConteo[productId] = {};
        if (!state.auditoriaConteo[productId][area]) state.auditoriaConteo[productId][area] = { enteras: 0, abiertas: [] };
        state.auditoriaConteo[productId][area].enteras = qty;
        saveToLocalStorage();
        showNotification(`✅ ${product.name}: ${qty} en ${AREAS[area] || area}`);
        close();
        _render();
        if (state.syncEnabled && window._db) import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    });
    setTimeout(() => { const i = overlay.querySelector('#_inv_qty_fb'); i?.focus(); i?.select(); }, 50);
}

// ═════════════════════════════════════════════════════════════
//  EXPORTAR EXCEL
// ═════════════════════════════════════════════════════════════

function exportToExcel(modo = 'INVENTARIO') {
    if (typeof window.XLSX === 'undefined') { showNotification('❌ Librería XLSX no disponible — recarga la página'); return; }
    if (modo !== 'INVENTARIO') { showNotification(`⚠️ Modo "${modo}" desconocido`); return; }

    const rows = [
        ['ID', 'Producto', 'Unidad', 'Grupo', 'Almacén', 'Barra 1', 'Barra 2', 'Total'],
        ...state.products.map(p => {
            const { porArea, total } = calcularStockTotal(p.id);
            return [p.id, p.name, p.unit || '', p.group || 'General',
                (porArea.almacen || 0).toFixed(4), (porArea.barra1 || 0).toFixed(4),
                (porArea.barra2 || 0).toFixed(4), total.toFixed(4)];
        }),
    ];
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const fileName = `inventario_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    showNotification(`📊 Excel exportado: ${fileName}`);
}

function exportarAuditoriaExcel() {
    if (typeof window.XLSX === 'undefined') { showNotification('❌ Librería XLSX no disponible'); return; }
    const rows = [['ID', 'Producto', 'Unidad', 'Grupo',
        'Almacén Enteras', 'Almacén Abiertas',
        'Barra1 Enteras', 'Barra1 Abiertas',
        'Barra2 Enteras', 'Barra2 Abiertas', 'Total']];
    state.products.forEach(p => {
        const row = [p.id, p.name, p.unit || '', p.group || 'General'];
        let total = 0;
        AREA_KEYS.forEach(area => {
            const c = state.auditoriaConteo[p.id]?.[area];
            const enteras = c?.enteras || 0;
            const abiertas = Array.isArray(c?.abiertas) ? c.abiertas.length : 0;
            row.push(enteras, abiertas);
            total += enteras + abiertas * 0.5;
        });
        row.push(total.toFixed(4));
        rows.push(row);
    });
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');
    const fileName = `auditoria_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    showNotification(`📊 Auditoría exportada: ${fileName}`);
}

// ═════════════════════════════════════════════════════════════
//  EXPORTAR JSON COMPLETO (respaldo)
//  FIX v2.4: El sidebar llama exportFullData() pero nunca estaba
//  definida en ningún módulo → error silencioso al exportar.
// ═════════════════════════════════════════════════════════════

function exportFullData() {
    try {
        const backup = {
            _exportedAt:               new Date().toISOString(),
            _version:                  '2.4',
            products:                  state.products,
            inventories:               state.inventories,
            orders:                    state.orders,
            inventarioConteo:          state.inventarioConteo,
            auditoriaConteo:           state.auditoriaConteo,
            auditoriaStatus:           state.auditoriaStatus,
            auditoriaConteoPorUsuario: state.auditoriaConteoPorUsuario,
            ajustes:                   state.ajustes,
        };
        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `BarInventory_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification(`✅ Respaldo exportado (${state.products.length} productos)`);
    } catch (err) {
        showNotification('❌ Error al exportar: ' + err.message);
        console.error('[Export] Error:', err);
    }
}

// ═════════════════════════════════════════════════════════════
//  MODAL DE PEDIDO / CARRITO
// ═════════════════════════════════════════════════════════════

function openOrderModal() {
    if (state.cart.length === 0) { showNotification('🛒 El carrito está vacío'); return; }

    const overlay = document.createElement('div');
    overlay.id = '_orderModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center;animation:fadeIn 0.15s ease both;';

    const buildItemsHtml = () => state.cart.map((item, idx) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.82rem;font-weight:600;color:var(--txt-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
          <div style="font-size:0.68rem;color:var(--txt-muted);">${escapeHtml(item.unit || '')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <button onclick="window._cartDec(${idx})" style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border-mid);background:var(--surface);color:var(--txt-primary);font-size:1rem;cursor:pointer;">−</button>
          <span style="font-weight:700;font-size:0.9rem;color:var(--txt-primary);min-width:24px;text-align:center;">${item.quantity}</span>
          <button onclick="window._cartInc(${idx})" style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border-mid);background:var(--surface);color:var(--txt-primary);font-size:1rem;cursor:pointer;">+</button>
          <button onclick="window._cartRem(${idx})" style="width:26px;height:26px;border-radius:50%;border:none;background:#fee2e2;color:#dc2626;font-size:0.7rem;cursor:pointer;">✕</button>
        </div>
      </div>`).join('');

    overlay.innerHTML = `
      <div style="background:var(--card);border-radius:var(--r-lg) var(--r-lg) 0 0;padding:20px 20px 28px;width:100%;max-width:480px;max-height:85vh;overflow-y:auto;box-shadow:var(--shadow-modal);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <p style="font-weight:700;font-size:1rem;color:var(--txt-primary);margin:0;">🛒 Confirmar pedido</p>
          <button id="_om_close" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--txt-muted);">×</button>
        </div>
        <div id="_om_items">${buildItemsHtml()}</div>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:0.7rem;font-weight:700;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:4px;">Proveedor</label>
            <input id="_om_supplier" type="text" placeholder="Nombre del proveedor"
              style="width:100%;box-sizing:border-box;padding:8px 10px;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
          </div>
          <div>
            <label style="display:block;font-size:0.7rem;font-weight:700;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:4px;">Nota (opcional)</label>
            <textarea id="_om_note" rows="2" placeholder="Instrucciones adicionales…"
              style="width:100%;box-sizing:border-box;padding:8px 10px;resize:vertical;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;"></textarea>
          </div>
        </div>
        <button id="_om_send" style="width:100%;margin-top:16px;padding:12px;background:linear-gradient(135deg,#25d366,#128c7e);border:none;border-radius:var(--r-lg);color:#fff;font-size:0.9rem;font-weight:700;cursor:pointer;">
          📲 Enviar por WhatsApp
        </button>
      </div>`;

    document.body.appendChild(overlay);

    const refresh = () => {
        const c = overlay.querySelector('#_om_items');
        if (!c) return;
        if (state.cart.length === 0) { close(); return; }
        c.innerHTML = buildItemsHtml();
    };

    window._cartInc = idx => { if (state.cart[idx]) { state.cart[idx].quantity += 1; refresh(); } };
    window._cartDec = idx => {
        if (state.cart[idx]) {
            state.cart[idx].quantity -= 1;
            if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
            refresh();
        }
    };
    window._cartRem = idx => { state.cart.splice(idx, 1); refresh(); };

    const close = () => {
        overlay.remove();
        delete window._cartInc; delete window._cartDec; delete window._cartRem;
        saveToLocalStorage(); _render();
    };

    overlay.querySelector('#_om_close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_om_send').addEventListener('click', () => {
        if (state.cart.length === 0) { showNotification('🛒 El carrito está vacío'); return; }
        const supplier = (overlay.querySelector('#_om_supplier').value || '').trim() || 'Proveedor';
        const note     = (overlay.querySelector('#_om_note').value || '').trim();
        const fecha    = new Date().toLocaleDateString('es-MX');
        const orderId  = 'PED-' + Date.now();
        const order = { id: orderId, supplier, date: fecha, note,
            total: state.cart.reduce((s, i) => s + i.quantity, 0),
            products: state.cart.map(i => ({ ...i })) };
        state.orders.unshift(order);
        if (state.orders.length > 100) state.orders.pop();
        const lines = [
            `📦 *Pedido ${orderId}*`, `Proveedor: *${supplier}*`, `Fecha: ${fecha}`, '',
            '*Productos:*', ...state.cart.map(i => `• ${i.name} (${i.unit || 'Unid'}): *${i.quantity}*`),
            '', note ? `📝 Nota: ${note}` : null, `Total items: *${order.total}*`,
        ].filter(l => l !== null).join('\n');
        state.cart = [];
        saveToLocalStorage();
        close();
        window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
        showNotification(`✅ Pedido ${orderId} enviado`);
    });
}

// ═════════════════════════════════════════════════════════════
//  BINDINGS GLOBALES
// ═════════════════════════════════════════════════════════════
window.openProductModal       = openProductModal;
window.editProduct            = editProduct;
window.deleteProduct          = deleteProduct;
window.deleteAllProducts      = deleteAllProducts;
window.addToCart              = addToCart;
window.openOrderModal         = openOrderModal;
window.shareOrderWhatsApp     = shareOrderWhatsApp;
window.deleteOrder            = deleteOrder;
window.switchArea             = switchArea;
window.saveInventory          = saveInventory;
window.shareInventoryWhatsApp = shareInventoryWhatsApp;
window.deleteInventory        = deleteInventory;
window.resetAllInventario     = resetAllInventario;
window.openInventarioModal    = openInventarioModal;
window.exportToExcel          = exportToExcel;
window.exportarAuditoriaExcel = exportarAuditoriaExcel;
window.exportFullData         = exportFullData;

// FIX v2.4: Funciones del modal estático #inventarioModal
// Eran llamadas desde index.html pero NUNCA estaban definidas en ningún módulo.
window.addAbiertaInModal    = addAbiertaInModal;
window.closeInventarioModal = closeInventarioModal;
window.saveInventarioModal  = saveInventarioModal;

console.info('[Actions] ✓ 20 funciones expuestas en window.');
