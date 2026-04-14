/**
 * js/actions.js — v3.0 DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 * FIX BUG-2: 8 funciones del HTML estático sin implementar.
 *   closeProductModal, saveProduct, closeOrderModal, createOrder,
 *   addAbiertaInModal, closeInventarioModal, saveInventarioModal,
 *   exportFullData — ninguna existía → botones Guardar/Cancelar
 *   de los 3 modales no hacían absolutamente nada.
 *
 * FIX BUG-3: openOrderModal creaba overlay dinámico propio
 *   ignorando #orderModal del HTML. Los campos #orderSupplier,
 *   #orderNote, #orderDeliveryDate nunca se leían. La tabla
 *   #orderProductsTable nunca se llenaba.
 *
 * FIX BUG-4: openInventarioModal creaba overlay simple (solo
 *   un número) ignorando #inventarioModal con botellas abiertas.
 *   Las botellas abiertas con oz nunca funcionaban.
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

const _render = () => import('./render.js').then(m => m.renderTab()).catch(() => {});

// Helper: guardar + render + sync en una sola llamada
function _commit() {
  saveToLocalStorage();
  _render();
  if (state.syncEnabled && window._db && navigator.onLine) {
    import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
  }
}

// Helper: acceso a elementos del DOM
const _el = id => document.getElementById(id);
function _showModal(id) { _el(id)?.classList.remove('hidden'); }
function _hideModal(id) { _el(id)?.classList.add('hidden'); }

// Estado interno del modal de producto
let _editingProductId = null;

// Estado interno del modal de inventario
let _invProductId = null;
let _invArea      = null;

// ══════════════════════════════════════════════════════════════
// MODAL DE PRODUCTO — usa #productModal del HTML
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

  // Actualizar título
  const titleEl = _el('productModalTitle');
  if (titleEl) titleEl.textContent = isEdit ? '✏️ Editar producto' : '➕ Nuevo producto';

  // Pre-llenar campos
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

// FIX BUG-2: esta función no existía → Cancelar no hacía nada
function closeProductModal() {
  _hideModal('productModal');
  _editingProductId = null;
  ['productId','productName','productGroup','productCapacidadMl','productPesoLlenaOz']
    .forEach(id => { const el = _el(id); if (el) el.value = ''; });
  const fUnit = _el('productUnit');
  if (fUnit) fUnit.value = 'Botellas';
}

// FIX BUG-2: esta función no existía → Guardar no hacía nada
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
    // Incremento inteligente: 0.1 para unidades de peso (KG/GR/LT/L), 1 para el resto
    const step = _getStep(product.unit);
    existing.quantity = Math.round((existing.quantity + step) * 1000) / 1000;
    showNotification(`🛒 ${product.name} → ${_fmtQty(existing.quantity)} ${product.unit || ''}`);
  } else {
    const step = _getStep(product.unit);
    state.cart.push({ id: product.id, name: product.name, unit: product.unit || 'Unidad', quantity: step });
    showNotification(`🛒 ${product.name} agregado`);
  }
  saveToLocalStorage();
  _render();
  if (!_el('orderModal')?.classList.contains('hidden')) _refreshOrderModal();
}

// Paso de incremento/decremento según unidad de medida
function _getStep(unit) {
  const u = (unit || '').toLowerCase();
  if (u.includes('kg') || u.includes('kilo') || u.includes('gr') || u.includes('gram') ||
      u.includes('lt') || u.includes('litro') || u.includes('ml') || u.includes('liter')) {
    return 0.1;
  }
  return 1;
}

// Formato de cantidad: sin decimales innecesarios (1 → "1", 0.350 → "0.350")
function _fmtQty(qty) {
  if (!qty && qty !== 0) return '0';
  const n = parseFloat(qty);
  if (isNaN(n)) return '0';
  // Mostrar hasta 3 decimales, quitando ceros finales
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/0+$/, '');
}

// ══════════════════════════════════════════════════════════════
// MODAL DE PEDIDO — FIX BUG-3: usa #orderModal del HTML
// ══════════════════════════════════════════════════════════════

// FIX BUG-3 + DECIMALES: llena #orderProductsTable con inputs editables
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

  // Total: suma formateada
  const totalItems = state.cart.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
  if (totalEl) totalEl.textContent = `Total: ${_fmtQty(totalItems)}`;

  tbody.innerHTML = state.cart.map((item, idx) => {
    const step = _getStep(item.unit);
    const qtyDisplay = _fmtQty(item.quantity);
    return `
    <tr class="hover:bg-gray-50">
      <td class="px-4 py-3 text-gray-900 text-sm font-medium">${escapeHtml(item.name)}</td>
      <td class="px-4 py-3 text-center text-gray-600 text-sm">${escapeHtml(item.unit || '')}</td>
      <td class="px-4 py-3 text-center">
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <button onclick="window._cartDec(${idx})"
            style="width:28px;height:28px;border-radius:50%;border:1px solid #e5e7eb;
                   background:#f9fafb;font-size:1rem;cursor:pointer;flex-shrink:0;">−</button>
          <input
            type="number"
            min="0"
            step="${step}"
            value="${qtyDisplay}"
            data-idx="${idx}"
            oninput="window._cartEdit(${idx}, this.value)"
            style="width:64px;text-align:center;font-weight:700;font-size:0.92rem;
                   border:1px solid #d1d5db;border-radius:6px;padding:3px 4px;
                   background:#fff;color:#111;">
          <button onclick="window._cartInc(${idx})"
            style="width:28px;height:28px;border-radius:50%;border:1px solid #e5e7eb;
                   background:#f9fafb;font-size:1rem;cursor:pointer;flex-shrink:0;">+</button>
        </div>
      </td>
      <td class="px-4 py-3 text-center">
        <button onclick="window._cartRem(${idx})"
          style="padding:3px 10px;background:#fee2e2;color:#dc2626;border:none;
                 border-radius:6px;font-size:0.75rem;cursor:pointer;">✕ Quitar</button>
      </td>
    </tr>`;
  }).join('');
}

// FIX BUG-3: openOrderModal ahora usa el modal estático #orderModal
function openOrderModal() {
  if (state.cart.length === 0) { showNotification('🛒 El carrito está vacío — agrega productos primero'); return; }

  const fSupplier = _el('orderSupplier');
  const fDate     = _el('orderDeliveryDate');
  const fNote     = _el('orderNote');
  if (fSupplier) fSupplier.value = '';
  if (fDate)     fDate.value     = '';
  if (fNote)     fNote.value     = '';

  window._cartInc = idx => {
    if (!state.cart[idx]) return;
    const step = _getStep(state.cart[idx].unit);
    state.cart[idx].quantity = Math.round((parseFloat(state.cart[idx].quantity) + step) * 1000) / 1000;
    _refreshOrderModal(); saveToLocalStorage();
  };
  window._cartDec = idx => {
    if (!state.cart[idx]) return;
    const step = _getStep(state.cart[idx].unit);
    state.cart[idx].quantity = Math.round((parseFloat(state.cart[idx].quantity) - step) * 1000) / 1000;
    if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
    if (state.cart.length === 0) { closeOrderModal(); return; }
    _refreshOrderModal(); saveToLocalStorage();
  };
  window._cartRem = idx => {
    state.cart.splice(idx, 1);
    if (state.cart.length === 0) { closeOrderModal(); return; }
    _refreshOrderModal(); saveToLocalStorage();
  };
  // Edición directa del input numérico
  window._cartEdit = (idx, rawVal) => {
    if (!state.cart[idx]) return;
    const val = parseFloat(rawVal);
    if (isNaN(val) || val < 0) return;
    state.cart[idx].quantity = Math.round(val * 1000) / 1000;
    // Actualizar solo el total sin re-renderizar toda la tabla (para no mover el cursor)
    const totalEl = _el('orderTotal');
    const totalItems = state.cart.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
    if (totalEl) totalEl.textContent = `Total: ${_fmtQty(totalItems)}`;
    saveToLocalStorage();
  };
  };

  _refreshOrderModal();
  _showModal('orderModal');
  setTimeout(() => _el('orderSupplier')?.focus(), 60);
}

// FIX BUG-2: esta función no existía → Cancelar no hacía nada
function closeOrderModal() {
  _hideModal('orderModal');
  delete window._cartInc;
  delete window._cartDec;
  delete window._cartRem;
  saveToLocalStorage();
  _render();
}

// FIX BUG-2: esta función no existía → "Compartir WhatsApp" no hacía nada
function createOrder() {
  if (state.cart.length === 0) { showNotification('🛒 El carrito está vacío'); return; }

  const supplier     = (_el('orderSupplier')?.value || '').trim() || 'Proveedor';
  const deliveryDate = _el('orderDeliveryDate')?.value || '';
  const note         = (_el('orderNote')?.value || '').trim();
  const fecha        = new Date().toLocaleDateString('es-MX');

  // ID legible: PED-BARRA-DDMM-NNN (secuencial diario en localStorage)
  const orderId = _generarIdPedido();

  const order = {
    id: orderId, supplier, date: fecha,
    deliveryDate: deliveryDate || null,
    note: note || null,
    total:    state.cart.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0),
    products: state.cart.map(i => ({ ...i })),
  };
  state.orders.unshift(order);
  if (state.orders.length > 100) state.orders.pop();

  const lines = [
    `📦 *Pedido ${orderId}*`,
    `Proveedor: *${supplier}*`,
    `Fecha: ${fecha}`,
    deliveryDate ? `Entrega: ${deliveryDate}` : null,
    '',
    '*Productos:*',
    ...state.cart.map(i => `• ${escapeHtml(i.name)} (${escapeHtml(i.unit || 'Unid')}): *${_fmtQty(i.quantity)}*`),
    '',
    note ? `📝 Nota: ${note}` : null,
    `Total: *${_fmtQty(order.total)} ${state.cart.length === 1 ? state.cart[0].unit : 'unidades'}*`,
  ].filter(l => l !== null).join('\n');

  state.cart = [];
  closeOrderModal();
  saveToLocalStorage();
  _render();

  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
  showNotification(`✅ ${orderId} enviado`);
}

// Genera ID de pedido legible con secuencial diario
// Formato: PED-BARRA-DDMM-001
function _generarIdPedido() {
  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const hoy  = `${dd}${mm}${now.getFullYear()}`;

  let lastDate = '';
  let seq = 0;
  try {
    const stored = JSON.parse(localStorage.getItem('bar_pedido_seq') || '{}');
    lastDate = stored.date || '';
    seq      = stored.seq  || 0;
  } catch (_) {}

  if (lastDate === hoy) {
    seq += 1;
  } else {
    seq = 1;
  }

  try {
    localStorage.setItem('bar_pedido_seq', JSON.stringify({ date: hoy, seq }));
  } catch (_) {}

  return `PED-BARRA-${dd}${mm}-${String(seq).padStart(3, '0')}`;
}

function shareOrderWhatsApp(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) { showNotification('⚠️ Pedido no encontrado'); return; }
  const lines = [
    `📦 *Pedido ${order.id}*`,
    `Proveedor: ${order.supplier || '—'}`,
    `Fecha: ${order.date || '—'}`,
    order.deliveryDate ? `Entrega: ${order.deliveryDate}` : null,
    '',
    '*Productos:*',
    ...(order.products || []).map(p => `• ${escapeHtml(p.name)} (${escapeHtml(p.unit || 'Unid')}): *${_fmtQty(p.quantity)}*`),
    '',
    order.note ? `📝 ${order.note}` : null,
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
// MODAL DE INVENTARIO — FIX BUG-4: usa #inventarioModal del HTML
// ══════════════════════════════════════════════════════════════

// FIX BUG-4: openInventarioModal ahora usa el modal estático
// con la sección completa de botellas abiertas (oz)
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

// FIX BUG-2: esta función no existía → + Agregar no hacía nada
function addAbiertaInModal() {
  const container = _el('inv_abiertasContainer');
  if (container) _addAbiertaRow(container);
}

// FIX BUG-2: esta función no existía → Cancelar no hacía nada
function closeInventarioModal() {
  _hideModal('inventarioModal');
  _invProductId = null;
  _invArea      = null;
}

// FIX BUG-2+4: esta función no existía → Guardar conteo no hacía nada
// Ahora guarda enteras + array de oz en auditoriaConteo correctamente
function saveInventarioModal() {
  if (!_invProductId || !_invArea) { closeInventarioModal(); return; }
  const productId = _invProductId;
  const area      = _invArea;
  const product   = state.products.find(p => p.id === productId);
  if (!product) { closeInventarioModal(); return; }

  const enteras = Math.max(0, parseFloat(_el('inv_enteras')?.value) || 0);

  // Leer y validar botellas abiertas
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

  // Guardar en auditoriaConteo { enteras, abiertas:[oz,...] }
  if (!state.auditoriaConteo[productId])       state.auditoriaConteo[productId] = {};
  state.auditoriaConteo[productId][area] = { enteras, abiertas };

  // Guardar en inventarioConteo (número plano para stockByArea)
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

// Fallback si el modal estático no existe en el DOM
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
// EXPORTAR EXCEL
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

function exportarAuditoriaExcel() {
  if (typeof window.XLSX === 'undefined') { showNotification('❌ Librería XLSX no disponible'); return; }
  const rows = [['ID','Producto','Unidad','Grupo',
    'Almacén Enteras','Almacén Abiertas','Barra1 Enteras','Barra1 Abiertas',
    'Barra2 Enteras','Barra2 Abiertas','Total']];
  state.products.forEach(p => {
    const row = [p.id, p.name, p.unit||'', p.group||'General'];
    let total = 0;
    AREA_KEYS.forEach(area => {
      const c = state.auditoriaConteo[p.id]?.[area];
      const enteras  = c?.enteras || 0;
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

// FIX BUG-2: exportFullData no existía → "Exportar datos" no hacía nada
function exportFullData() {
  try {
    const backup = {
      _exportedAt:               new Date().toISOString(),
      _version:                  '3.0',
      products:                  state.products,
      inventories:               state.inventories,
      orders:                    state.orders,
      inventarioConteo:          state.inventarioConteo,
      auditoriaConteo:           state.auditoriaConteo,
      auditoriaStatus:           state.auditoriaStatus,
      auditoriaConteoPorUsuario: state.auditoriaConteoPorUsuario,
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

// Funciones llamadas desde render.js (HTML generado)
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

// FIX BUG-2: Funciones del HTML estático que no existían en ningún módulo
window.closeProductModal      = closeProductModal;   // index.html línea Cancelar del modal producto
window.saveProduct            = saveProduct;          // index.html línea Guardar del modal producto
window.closeOrderModal        = closeOrderModal;      // index.html línea Cancelar del modal pedido
window.createOrder            = createOrder;          // index.html línea WhatsApp del modal pedido
window.addAbiertaInModal      = addAbiertaInModal;    // index.html botón + Agregar
window.closeInventarioModal   = closeInventarioModal; // index.html Cancelar del modal inventario
window.saveInventarioModal    = saveInventarioModal;  // index.html Guardar conteo

console.info('[Actions] ✓ v3.0 — 24 funciones en window (8 nuevas).');
