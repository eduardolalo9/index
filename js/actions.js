/**
 * js/actions.js — v3.1
 * ══════════════════════════════════════════════════════════════
 * Acciones principales de la app (modales, carrito, inventario,
 * exportación Excel).
 *
 * CAMBIOS v3.1:
 *   • exportarAuditoriaExcel() — reescrita con formato EXACTO:
 *       Hoja "Auditoría", columnas: ID, Nombre, Unidad, Grupo,
 *       CapacidadML, PesoBotellaOz + por área: Enteras, Oz Abiertas,
 *       Total + Total General + Estado.
 *       Subtotales por Grupo con fila destacada.
 *       Gran Total al final.
 *       Usa auditoriaConteoPorUsuario (promedio enteras, suma abiertas)
 *       con fallback a auditoriaConteo.
 *   • Mantiene todo el código existente v3.0 sin cambios.
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
import { AREAS, AREA_KEYS }         from './constants.js';
import { PESO_BOTELLA_VACIA_OZ }    from './constants.js';

const _render = () => import('./render.js').then(m => m.renderTab()).catch(() => {});

function _commit() {
  saveToLocalStorage();
  _render();
  if (state.syncEnabled && window._db && navigator.onLine) {
    import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
  }
}

const _el = id => document.getElementById(id);
function _showModal(id) { _el(id)?.classList.remove('hidden'); }
function _hideModal(id) { _el(id)?.classList.add('hidden'); }

function _fmtQty(qty) {
  const n = parseFloat(qty) || 0;
  if (Number.isInteger(n)) return String(n);
  let s = n.toFixed(3);
  if (s.startsWith('0.')) s = s.slice(1);
  return s;
}

function _fmtTotal(qty) {
  const n = parseFloat(qty) || 0;
  return parseFloat(n.toFixed(3)).toString();
}

let _editingProductId = null;
let _invProductId = null;
let _invArea      = null;

// ══════════════════════════════════════════════════════════════
// MODAL DE PRODUCTO
// ══════════════════════════════════════════════════════════════

function openProductModal(productId = null) {
  if (state.userRole !== 'admin') {
    showNotification('⛔ Solo el administrador puede modificar productos');
    return;
  }

  _editingProductId = productId || null;
  const isEdit  = !!productId;
  const product = isEdit ? state.products.find(p => p.id === productId) : null;
  if (isEdit && !product) { showNotification('⚠️ Producto no encontrado'); return; }

  const titleEl = _el('productModalTitle');
  if (titleEl) titleEl.textContent = isEdit ? '✏️ Editar producto' : '➕ Nuevo producto';

  const fId    = _el('productId');
  const fName  = _el('productName');
  const fUnit  = _el('productUnit');
  const fGroup = _el('productGroup');
  const fCap   = _el('productCapacidadMl');
  const fPeso  = _el('productPesoLlenaOz');

  if (fId)   { fId.value = product?.id || '';  fId.disabled = isEdit; }
  if (fName)  fName.value  = product?.name  || '';
  if (fGroup) fGroup.value = product?.group || '';
  if (fCap)   fCap.value   = product?.capacidadMl        || '';
  if (fPeso)  fPeso.value  = product?.pesoBotellaLlenaOz || '';
  if (fUnit) {
    fUnit.value = product?.unit || 'Botellas';
    if (product?.unit && !Array.from(fUnit.options).find(o => o.value === product.unit)) {
      const opt = document.createElement('option');
      opt.value = product.unit; opt.textContent = product.unit;
      fUnit.appendChild(opt);
    }
    fUnit.value = product?.unit || 'Botellas';
  }

  _showModal('productModal');
  setTimeout(() => fName?.focus(), 60);
}

function closeProductModal() {
  _hideModal('productModal');
  _editingProductId = null;
  ['productId','productName','productGroup','productCapacidadMl','productPesoLlenaOz']
    .forEach(id => { const el = _el(id); if (el) el.value = ''; });
  const fUnit = _el('productUnit');
  if (fUnit) fUnit.value = 'Botellas';
}

function saveProduct() {
  const name     = (_el('productName')?.value || '').trim();
  const rawId    = (_el('productId')?.value   || '').trim();
  const unit     = _el('productUnit')?.value  || 'Botellas';
  const group    = (_el('productGroup')?.value || '').trim() || 'General';
  const capRaw   = parseFloat(_el('productCapacidadMl')?.value) || null;
  const pesoRaw  = parseFloat(_el('productPesoLlenaOz')?.value) || null;

  if (!name) { showNotification('⚠️ El nombre es obligatorio'); _el('productName')?.focus(); return; }
  if (name.length < 2) { showNotification('⚠️ El nombre debe tener al menos 2 caracteres'); return; }

  if (_editingProductId) {
    updateProduct(_editingProductId, {
      name, unit, group,
      capacidadMl:        capRaw  > 0 ? capRaw  : null,
      pesoBotellaLlenaOz: pesoRaw > 0 ? pesoRaw : null,
    });
  } else {
    if (rawId && state.products.find(p => p.id === rawId)) {
      showNotification(`⚠️ El ID "${rawId}" ya existe`); return;
    }
    addProduct({ id: rawId || undefined, name, unit, group,
      capacidadMl: capRaw > 0 ? capRaw : null,
      pesoBotellaLlenaOz: pesoRaw > 0 ? pesoRaw : null });
  }

  closeProductModal();
  _commit();
}

function editProduct(id) { openProductModal(id); }

async function deleteProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return; }
  const ok = await showConfirm(`¿Eliminar "${product.name}"?\n\nEsta acción no se puede deshacer.`);
  if (!ok) return;
  _deleteProduct(id);
  _commit();
}

async function deleteAllProducts() {
  if (state.userRole !== 'admin') return;
  const ok = await showConfirm('¿Eliminar TODOS los productos?\n\nSe borrará el catálogo completo.');
  if (!ok) return;
  state.products = [];
  state.inventarioConteo = {};
  state.auditoriaConteo  = {};
  state.auditoriaConteoPorUsuario = {};
  showNotification('🗑️ Todos los productos eliminados');
  _commit();
}

// ══════════════════════════════════════════════════════════════
// CARRITO
// ══════════════════════════════════════════════════════════════

function addToCart(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return; }
  const existing = state.cart.find(i => i.id === productId);
  if (existing) {
    existing.quantity += 1;
    showNotification(`🛒 ${product.name} → ${existing.quantity}`);
  } else {
    state.cart.push({ id: product.id, name: product.name, unit: product.unit || 'Unidad', quantity: 1 });
    showNotification(`🛒 ${product.name} agregado`);
  }
  saveToLocalStorage();
  _render();
  if (!_el('orderModal')?.classList.contains('hidden')) _refreshOrderModal();
}

function _refreshOrderModal() {
  const tbody   = _el('orderProductsTable');
  const totalEl = _el('orderTotal');
  const emptyEl = _el('emptyCart');
  if (!tbody) return;

  if (state.cart.length === 0) {
    tbody.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    if (totalEl) totalEl.textContent = 'Total: 0';
    return;
  }

  emptyEl?.classList.add('hidden');
  const totalQty = state.cart.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
  if (totalEl) totalEl.textContent = `Total: ${_fmtTotal(totalQty)}`;

  tbody.innerHTML = state.cart.map((item, idx) => `
    <tr class="hover:bg-gray-50">
      <td class="px-4 py-3 text-gray-900 text-sm font-medium">${escapeHtml(item.name)}</td>
      <td class="px-4 py-3 text-center text-gray-600 text-sm">${escapeHtml(item.unit || '')}</td>
      <td class="px-4 py-3 text-center">
        <input type="number" min="0.001" step="0.001" value="${parseFloat(item.quantity) || 1}"
          onchange="window._cartSetQty(${idx}, this.value)"
          style="width:90px;padding:5px 8px;border:1.5px solid #e5e7eb;border-radius:8px;
                 text-align:center;font-weight:bold;font-size:0.95rem;color:#111827;
                 background:#f9fafb;outline:none;" onfocus="this.select()">
      </td>
      <td class="px-4 py-3 text-center">
        <button onclick="window._cartRem(${idx})" style="padding:3px 10px;background:#fee2e2;
          color:#dc2626;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;">✕ Quitar</button>
      </td>
    </tr>`).join('');
}

function openOrderModal() {
  if (state.cart.length === 0) { showNotification('🛒 El carrito está vacío — agrega productos primero'); return; }

  const fSupplier = _el('orderSupplier');
  const fDate     = _el('orderDeliveryDate');
  const fNote     = _el('orderNote');
  if (fSupplier) fSupplier.value = '';
  if (fDate)     fDate.value     = '';
  if (fNote)     fNote.value     = '';

  window._cartSetQty = (idx, val) => {
    const qty = parseFloat(val);
    if (isNaN(qty) || qty <= 0) {
      state.cart.splice(idx, 1);
      if (state.cart.length === 0) { closeOrderModal(); return; }
    } else {
      state.cart[idx].quantity = qty;
    }
    _refreshOrderModal(); saveToLocalStorage();
  };
  window._cartRem = idx => {
    state.cart.splice(idx, 1);
    if (state.cart.length === 0) { closeOrderModal(); return; }
    _refreshOrderModal(); saveToLocalStorage();
  };

  _refreshOrderModal();
  _showModal('orderModal');
  setTimeout(() => _el('orderSupplier')?.focus(), 60);
}

function closeOrderModal() {
  _hideModal('orderModal');
  delete window._cartSetQty;
  delete window._cartRem;
  saveToLocalStorage();
  _render();
}

function createOrder() {
  if (state.cart.length === 0) { showNotification('🛒 El carrito está vacío'); return; }

  const supplier     = (_el('orderSupplier')?.value || '').trim() || 'Proveedor';
  const deliveryDate = _el('orderDeliveryDate')?.value || '';
  const note         = (_el('orderNote')?.value || '').trim();
  const fecha        = new Date().toLocaleDateString('es-MX');
  const orderId      = 'BARRA-' + Date.now();
  const totalQty     = state.cart.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);

  const order = {
    id: orderId, supplier, date: fecha,
    deliveryDate: deliveryDate || null,
    note: note || null,
    total:    totalQty,
    products: state.cart.map(i => ({ ...i })),
  };
  state.orders.unshift(order);
  if (state.orders.length > 100) state.orders.pop();

  const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const lines = [
    `🛒 PEDIDO ${orderId}`,
    SEP,
    `🏪 Proveedor: ${supplier}`,
    deliveryDate ? `📅 Entrega: ${deliveryDate}` : null,
    SEP,
    'PRODUCTOS:',
    ...state.cart.map((i, n) => `${n + 1}. ${i.name} — ${_fmtQty(i.quantity)} (${i.unit || 'Unid'})`),
    SEP,
    `📦 Total: ${_fmtTotal(totalQty)}`,
    note ? `📝 Nota: ${note}` : null,
  ].filter(l => l !== null).join('\n');

  state.cart = [];
  closeOrderModal();
  saveToLocalStorage();
  _render();

  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
  showNotification(`✅ Pedido ${orderId} enviado`);
}

function shareOrderWhatsApp(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) { showNotification('⚠️ Pedido no encontrado'); return; }
  const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const totalQty = (order.products || []).reduce((s, p) => s + (parseFloat(p.quantity) || 0), 0);
  const lines = [
    `🛒 PEDIDO ${order.id}`,
    SEP,
    `🏪 Proveedor: ${order.supplier || '—'}`,
    order.deliveryDate ? `📅 Entrega: ${order.deliveryDate}` : null,
    SEP,
    'PRODUCTOS:',
    ...(order.products || []).map((p, n) => `${n + 1}. ${p.name} — ${_fmtQty(p.quantity)} (${p.unit || 'Unid'})`),
    SEP,
    `📦 Total: ${_fmtTotal(totalQty)}`,
    order.note ? `📝 Nota: ${order.note}` : null,
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

// ══════════════════════════════════════════════════════════════
// HISTORIAL DE INVENTARIO
// ══════════════════════════════════════════════════════════════

function switchArea(area) { state.selectedArea = area; _render(); }

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
  showNotification(`💾 Inventario de ${AREAS[area] || area} guardado`);
  _commit();
}

function shareInventoryWhatsApp(inventoryId) {
  const inv = state.inventories.find(i => i.id === inventoryId);
  if (!inv) { showNotification('⚠️ Inventario no encontrado'); return; }
  const lines = [
    `📊 *Inventario ${inv.id}*`,
    `Área: ${AREAS[inv.area] || inv.area || '—'}`,
    `Fecha: ${inv.date || '—'}`, `Usuario: ${inv.usuario || '—'}`, '',
    '*Productos:*',
    ...(inv.products || []).map(p => `• ${p.name}: *${(p.stock||0).toFixed(2)}* ${p.unit||''}`),
    '', `Total: *${(inv.totalProducts || 0).toFixed(2)}*`,
  ].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

async function deleteInventory(inventoryId) {
  if (state.userRole !== 'admin') return;
  const ok = await showConfirm('¿Eliminar este registro?\n\nNo se puede deshacer.');
  if (!ok) return;
  state.inventories = state.inventories.filter(i => i.id !== inventoryId);
  saveToLocalStorage();
  showNotification('🗑️ Registro eliminado');
  _render();
}

async function resetAllInventario() {
  if (state.userRole !== 'admin') return;
  const ok = await showConfirm('¿Resetear TODO el inventario?\n\nSe pondrán en cero todos los conteos.');
  if (!ok) return;
  state.inventarioConteo = {};
  state.products.forEach(p => { p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 }; });
  showNotification('🔄 Inventario reseteado a cero');
  _commit();
}

// ══════════════════════════════════════════════════════════════
// MODAL DE INVENTARIO
// ══════════════════════════════════════════════════════════════

function openInventarioModal(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

  const area  = state.selectedArea || 'almacen';
  const modal = _el('inventarioModal');
  if (!modal) { _openInventarioFallback(productId, area, product); return; }

  _invProductId = productId;
  _invArea      = area;

  const titleEl    = _el('inventarioModalTitle');
  const subtitleEl = _el('inventarioModalSubtitle');
  const hintEl     = _el('inv_abiertasUnidadHint');

  if (titleEl)    titleEl.textContent    = product.name;
  if (subtitleEl) subtitleEl.textContent = `Área: ${AREAS[area] || area}`;
  if (hintEl) {
    hintEl.textContent = product.pesoBotellaLlenaOz
      ? `(oz — llena: ${product.pesoBotellaLlenaOz} oz)` : '(oz)';
  }

  const enterasInput = _el('inv_enteras');
  if (enterasInput) {
    const current =
      state.auditoriaConteo[productId]?.[area]?.enteras ??
      state.inventarioConteo[productId]?.[area]         ??
      product.stockByArea?.[area] ?? 0;
    enterasInput.value = String(current);
  }

  const container = _el('inv_abiertasContainer');
  if (container) {
    container.innerHTML = '';
    const abiertas = state.auditoriaConteo[productId]?.[area]?.abiertas ?? [];
    abiertas.forEach(oz => _addAbiertaRow(container, oz));
  }

  _showModal('inventarioModal');
  setTimeout(() => { enterasInput?.focus(); enterasInput?.select(); }, 60);
}

function _addAbiertaRow(container, valorOz = '') {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  row.innerHTML = `
    <input type="number" min="0" step="0.1" value="${valorOz}"
      placeholder="Peso actual (oz)"
      style="flex:1;padding:8px 10px;background:#f9fafb;border:2px solid #f97316;
             border-radius:8px;color:#111827;font-size:0.9rem;text-align:center;"
      oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value='';">
    <button type="button" onclick="this.parentElement.remove()"
      style="width:30px;height:30px;flex-shrink:0;border-radius:50%;
             border:none;background:#fee2e2;color:#dc2626;font-size:0.8rem;cursor:pointer;">✕</button>`;
  container.appendChild(row);
  row.querySelector('input')?.focus();
}

function addAbiertaInModal() {
  const container = _el('inv_abiertasContainer');
  if (container) _addAbiertaRow(container);
}

function closeInventarioModal() {
  _hideModal('inventarioModal');
  _invProductId = null;
  _invArea      = null;
}

function saveInventarioModal() {
  if (!_invProductId || !_invArea) { closeInventarioModal(); return; }
  const productId = _invProductId;
  const area      = _invArea;
  const product   = state.products.find(p => p.id === productId);
  if (!product) { closeInventarioModal(); return; }

  const enteras = Math.max(0, parseFloat(_el('inv_enteras')?.value) || 0);

  const container = _el('inv_abiertasContainer');
  const abiertas  = [];
  const maxOz     = (product.pesoBotellaLlenaOz || 200) + 5;
  let rangeError  = false;

  if (container) {
    container.querySelectorAll('input[type="number"]').forEach(inp => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val <= 0) return;
      if (val > maxOz) { inp.style.borderColor = '#ef4444'; rangeError = true; return; }
      inp.style.borderColor = '#f97316';
      abiertas.push(Math.round(val * 100) / 100);
    });
  }

  if (rangeError) {
    showNotification(`⚠️ Algún peso supera ${maxOz} oz — verifica los valores`);
    return;
  }

  // Guardar en auditoriaConteo
  if (!state.auditoriaConteo[productId])       state.auditoriaConteo[productId] = {};
  state.auditoriaConteo[productId][area] = { enteras, abiertas };

  // Guardar en auditoriaConteoPorUsuario (multi-user)
  const userId   = state.auditCurrentUser?.userId || state.currentUser?.uid || 'anon';
  const userName = state.auditCurrentUser?.userName || state.currentUser?.email || 'Usuario';
  if (!state.auditoriaConteoPorUsuario[productId]) state.auditoriaConteoPorUsuario[productId] = {};
  if (!state.auditoriaConteoPorUsuario[productId][area]) state.auditoriaConteoPorUsuario[productId][area] = {};
  state.auditoriaConteoPorUsuario[productId][area][userId] = {
    enteras, abiertas, userId, userName, ts: Date.now()
  };

  // Guardar en inventarioConteo
  if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
  state.inventarioConteo[productId][area] = enteras;

  // Actualizar stockByArea
  if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  product.stockByArea[area] = enteras;

  const totalText = abiertas.length > 0
    ? `${enteras} ent. + ${abiertas.length} ab.`
    : `${enteras} uds`;
  showNotification(`✅ ${product.name}: ${totalText} en ${AREAS[area] || area}`);

  closeInventarioModal();
  _commit();
}

function _openInventarioFallback(productId, area, product) {
  const current = product.stockByArea?.[area] || 0;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--card,#fff);border-radius:12px;padding:24px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <p style="font-weight:700;font-size:0.9rem;color:#111;margin:0 0 4px;">${escapeHtml(product.name)}</p>
      <p style="font-size:0.72rem;color:#6b7280;margin:0 0 16px;">Área: ${AREAS[area] || area}</p>
      <input id="_inv_fb" type="number" min="0" step="0.5" value="${current}"
        style="width:100%;padding:10px;font-size:1.1rem;background:#f9fafb;border:2px solid #c4b5fd;border-radius:8px;text-align:center;box-sizing:border-box;">
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="_inv_fb_cancel" style="flex:1;padding:9px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;cursor:pointer;">Cancelar</button>
        <button id="_inv_fb_save" style="flex:2;padding:9px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;color:#fff;font-weight:700;cursor:pointer;">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#_inv_fb_cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#_inv_fb_save').addEventListener('click', () => {
    const qty = parseFloat(overlay.querySelector('#_inv_fb').value);
    if (isNaN(qty) || qty < 0) { showNotification('⚠️ Valor inválido'); return; }
    if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    product.stockByArea[area] = qty;
    if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
    state.inventarioConteo[productId][area] = qty;
    if (!state.auditoriaConteo[productId]) state.auditoriaConteo[productId] = {};
    if (!state.auditoriaConteo[productId][area]) state.auditoriaConteo[productId][area] = { enteras: 0, abiertas: [] };
    state.auditoriaConteo[productId][area].enteras = qty;
    close(); _commit();
  });
  setTimeout(() => { const i = overlay.querySelector('#_inv_fb'); i?.focus(); i?.select(); }, 50);
}

// ══════════════════════════════════════════════════════════════
// EXPORTAR EXCEL — INVENTARIO OPERATIVO
// ══════════════════════════════════════════════════════════════

function exportToExcel(modo = 'INVENTARIO') {
  if (typeof window.XLSX === 'undefined') { showNotification('❌ Librería XLSX no disponible'); return; }
  if (modo !== 'INVENTARIO') { showNotification(`⚠️ Modo "${modo}" desconocido`); return; }
  const rows = [
    ['ID','Producto','Unidad','Grupo','Almacén','Barra 1','Barra 2','Total'],
    ...state.products.map(p => {
      const { porArea, total } = calcularStockTotal(p.id);
      return [p.id, p.name, p.unit||'', p.group||'General',
        (porArea.almacen||0).toFixed(4),(porArea.barra1||0).toFixed(4),
        (porArea.barra2||0).toFixed(4),total.toFixed(4)];
    }),
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  const fileName = `inventario_${new Date().toISOString().slice(0,10)}.xlsx`;
  window.XLSX.writeFile(wb, fileName);
  showNotification(`📊 Excel exportado: ${fileName}`);
}

// ══════════════════════════════════════════════════════════════
// EXPORTAR EXCEL — AUDITORÍA FÍSICA CIEGA (FORMATO EXACTO v3.1)
// ══════════════════════════════════════════════════════════════

/**
 * Exporta la auditoría en el formato exacto especificado:
 *   Hoja "Auditoría"
 *   Columnas: ID, Nombre, Unidad, Grupo, CapacidadML, PesoBotellaOz
 *   + Por área: Enteras (promedio), Oz Abiertas (suma), Total (fracción)
 *   + Total General, Estado
 *   Subtotales por Grupo al final de cada grupo (fila ★)
 *   Gran Total final (fila ★★)
 *
 * Fuente de datos: auditoriaConteoPorUsuario (con fallback a auditoriaConteo)
 * Cálculo multiusuario:
 *   Enteras   = promedio redondeado de todos los usuarios por área
 *   Oz        = suma de todas las botellas abiertas de todos los usuarios
 *   Total     = enteras_avg + oz_to_fraction(pesoBotellaLlenaOz, capacidadMl)
 */
function exportarAuditoriaExcel() {
  const XLSX = window.XLSX;
  if (!XLSX) { showNotification('❌ Librería XLSX no disponible'); return; }
  if (!state.products.length) { showNotification('⚠️ No hay productos para exportar'); return; }

  // ── Encabezados ───────────────────────────────────────────
  const headerBase  = ['ID', 'Nombre', 'Unidad', 'Grupo', 'CapacidadML', 'PesoBotellaOz'];
  const headerAreas = [];
  AREA_KEYS.forEach(area => {
    const label = AREAS[area] || area;
    headerAreas.push(`${label} Enteras`, `${label} Oz Abiertas`, `${label} Total`);
  });
  const headerRow = [...headerBase, ...headerAreas, 'Total General', 'Estado'];
  const aoa = [headerRow];

  // ── Agrupar productos por Grupo ───────────────────────────
  const grupos = {};
  state.products.forEach(p => {
    const g = (p.group || 'General').trim();
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(p);
  });

  // Totales globales
  const granTotalArea = {};
  AREA_KEYS.forEach(a => { granTotalArea[a] = { enteras: 0, oz: 0, total: 0 }; });
  let granTotalGeneral = 0;

  Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0], 'es')).forEach(([grupo, prods]) => {
    const subArea = {};
    AREA_KEYS.forEach(a => { subArea[a] = { enteras: 0, oz: 0, total: 0 }; });
    let subTotal = 0;

    prods.forEach(p => {
      const rowData = [
        p.id,
        p.name,
        p.unit  || '',
        p.group || 'General',
        p.capacidadMl        ?? '',
        p.pesoBotellaLlenaOz ?? '',
      ];

      let totalGeneral = 0;

      AREA_KEYS.forEach(area => {
        const { enteras, ozAbiertas, total } = _calcConsolidadoLocal(p, area);
        rowData.push(enteras, ozAbiertas, total);
        subArea[area].enteras += enteras;
        subArea[area].oz      += ozAbiertas;
        subArea[area].total   += total;
        granTotalArea[area].enteras += enteras;
        granTotalArea[area].oz      += ozAbiertas;
        granTotalArea[area].total   += total;
        totalGeneral += total;
      });

      const totalRnd = Math.round(totalGeneral * 10000) / 10000;
      rowData.push(totalRnd, _estadoLocal(p));
      subTotal         += totalRnd;
      granTotalGeneral += totalRnd;
      aoa.push(rowData);
    });

    // Fila de subtotal del grupo
    const subRow = ['', `★ ${grupo.toUpperCase()} (subtotal)`, '', '', '', ''];
    AREA_KEYS.forEach(area => {
      subRow.push(
        Math.round(subArea[area].enteras),
        Math.round(subArea[area].oz * 1000) / 1000,
        Math.round(subArea[area].total * 100) / 100
      );
    });
    subRow.push(Math.round(subTotal * 100) / 100, '');
    aoa.push(subRow);

    // Separador vacío entre grupos
    aoa.push(new Array(headerRow.length).fill(''));
  });

  // ── Gran Total ────────────────────────────────────────────
  const granRow = ['', '★★ GRAN TOTAL', '', '', '', ''];
  AREA_KEYS.forEach(area => {
    granRow.push(
      Math.round(granTotalArea[area].enteras),
      Math.round(granTotalArea[area].oz * 1000) / 1000,
      Math.round(granTotalArea[area].total * 100) / 100
    );
  });
  granRow.push(Math.round(granTotalGeneral * 100) / 100, '');
  aoa.push(granRow);

  // ── Crear workbook ────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = _buildColWidths();

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');

  // ── Hoja de resumen rápido ────────────────────────────────
  const resumen = [
    ['BarInventory — Auditoría Física Ciega'],
    [''],
    ['Fecha de exportación', new Date().toLocaleString('es-MX')],
    ['Total productos', state.products.length],
    ['Bartenders registrados', Object.keys(state.auditUserRegistry || {}).length],
    [''],
    ['Estado de áreas'],
  ];
  AREA_KEYS.forEach(area => {
    const st = state.auditoriaStatus[area];
    resumen.push([AREAS[area], st === 'completada' ? '✓ Completada' : '⏳ Pendiente']);
  });
  const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
  wsResumen['!cols'] = [{ wch: 28 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // ── Exportar ──────────────────────────────────────────────
  const fecha    = new Date().toISOString().slice(0, 10);
  const fileName = `AUDITORIA_${fecha}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showNotification(`📊 Auditoría exportada: ${fileName}`);
}

// ── Helpers locales para exportarAuditoriaExcel ───────────────

function _calcConsolidadoLocal(product, area) {
  const porUsuario = state.auditoriaConteoPorUsuario[product.id]?.[area];

  if (!porUsuario || Object.keys(porUsuario).length === 0) {
    // Fallback a auditoriaConteo
    const c = state.auditoriaConteo[product.id]?.[area];
    if (!c) return { enteras: 0, ozAbiertas: 0, total: 0 };
    const enteras  = typeof c.enteras === 'number' ? c.enteras : 0;
    const abiertas = Array.isArray(c.abiertas) ? c.abiertas : [];
    const oz       = abiertas.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    return {
      enteras,
      ozAbiertas: Math.round(oz * 1000) / 1000,
      total:      Math.round(_ozToFraccion(product, enteras, abiertas) * 10000) / 10000,
    };
  }

  const users = Object.values(porUsuario);
  let sumEnt = 0;
  const todasAb = [];
  users.forEach(u => {
    sumEnt += typeof u.enteras === 'number' ? u.enteras : 0;
    if (Array.isArray(u.abiertas)) u.abiertas.forEach(oz => { if (oz > 0) todasAb.push(oz); });
  });
  const avgEnt = users.length > 0 ? Math.round(sumEnt / users.length) : 0;
  const totalOz = todasAb.reduce((s, v) => s + v, 0);

  return {
    enteras:    avgEnt,
    ozAbiertas: Math.round(totalOz * 1000) / 1000,
    total:      Math.round(_ozToFraccion(product, avgEnt, todasAb) * 10000) / 10000,
  };
}

function _ozToFraccion(product, enteras, abiertasArr) {
  if (!abiertasArr.length) return enteras;
  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;
  if (pesoLlena <= pesoVacia) return enteras + abiertasArr.length * 0.5;
  const contenido = pesoLlena - pesoVacia;
  let frac = 0;
  abiertasArr.forEach(oz => {
    const p = parseFloat(oz) || 0;
    if      (p <= pesoVacia) frac += 0;
    else if (p >= pesoLlena) frac += 1;
    else    frac += (p - pesoVacia) / contenido;
  });
  return parseFloat((enteras + frac).toFixed(4));
}

function _estadoLocal(product) {
  const ok = product.capacidadMl > 0 && product.pesoBotellaLlenaOz > 0;
  if (ok) return 'Conversión realizada';
  const falta = [];
  if (!product.capacidadMl || product.capacidadMl <= 0)              falta.push('CapacidadMl');
  if (!product.pesoBotellaLlenaOz || product.pesoBotellaLlenaOz <= 0) falta.push('PesoBotellaOz');
  return `Falta: ${falta.join(', ')}`;
}

function _buildColWidths() {
  const cols = [
    { wch: 10 }, // ID
    { wch: 28 }, // Nombre
    { wch: 10 }, // Unidad
    { wch: 18 }, // Grupo
    { wch: 12 }, // CapacidadML
    { wch: 14 }, // PesoBotellaOz
  ];
  AREA_KEYS.forEach(() => {
    cols.push({ wch: 10 }, { wch: 13 }, { wch: 10 });
  });
  cols.push({ wch: 14 }, { wch: 32 }); // Total General, Estado
  return cols;
}

// ══════════════════════════════════════════════════════════════
// EXPORTAR JSON COMPLETO
// ══════════════════════════════════════════════════════════════

function exportFullData() {
  try {
    const backup = {
      _exportedAt:               new Date().toISOString(),
      _version:                  '3.1',
      products:                  state.products,
      inventories:               state.inventories,
      orders:                    state.orders,
      inventarioConteo:          state.inventarioConteo,
      auditoriaConteo:           state.auditoriaConteo,
      auditoriaStatus:           state.auditoriaStatus,
      auditoriaConteoPorUsuario: state.auditoriaConteoPorUsuario,
      auditoriaStatusPorUsuario: state.auditoriaStatusPorUsuario,
      auditUserRegistry:         state.auditUserRegistry,
      ajustes:                   state.ajustes,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `BarInventory_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`✅ Respaldo exportado — ${state.products.length} productos`);
  } catch (err) {
    showNotification('❌ Error al exportar: ' + err.message);
    console.error('[Export]', err);
  }
}

// ══════════════════════════════════════════════════════════════
// BINDINGS GLOBALES
// ══════════════════════════════════════════════════════════════

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
window.closeProductModal      = closeProductModal;
window.saveProduct            = saveProduct;
window.closeOrderModal        = closeOrderModal;
window.createOrder            = createOrder;
window.addAbiertaInModal      = addAbiertaInModal;
window.closeInventarioModal   = closeInventarioModal;
window.saveInventarioModal    = saveInventarioModal;

console.info('[Actions] ✓ v3.1 — Excel exacto con subtotales por grupo.');
