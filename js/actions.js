/**
 * js/actions.js — v3.0 CORREGIDO DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 *
 * BUGS CORREGIDOS EN ESTA VERSIÓN:
 *
 * BUG-1 (CRÍTICO): 8 funciones del HTML estático sin implementar.
 *   index.html llama closeProductModal(), saveProduct(),
 *   closeOrderModal(), createOrder(), exportFullData(),
 *   addAbiertaInModal(), closeInventarioModal(), saveInventarioModal()
 *   pero NINGUNA existía en ningún módulo JS.
 *   → Al hacer clic en Cancelar/Guardar: NADA OCURRÍA.
 *   CORRECCIÓN: Todas implementadas y expuestas en window.
 *
 * BUG-2 (CRÍTICO): Los 3 modales creaban overlays dinámicos PROPIOS
 *   ignorando los modales estáticos del HTML (#productModal,
 *   #orderModal, #inventarioModal) que ya tienen campos y estilos.
 *   Resultado: duplicación visual, campos del HTML nunca se leían.
 *   CORRECCIÓN: Cada función de abrir/cerrar usa el modal estático.
 *
 * BUG-3 (CRÍTICO): openOrderModal no actualizaba #orderProductsTable,
 *   #orderTotal ni #emptyCart del HTML.
 *   CORRECCIÓN: _refreshOrderModal() sincroniza el HTML del pedido.
 *
 * BUG-4: openInventarioModal ignoraba #inventarioModal estático.
 *   addAbiertaInModal/closeInventarioModal/saveInventarioModal
 *   no estaban implementadas.
 *   CORRECCIÓN: Conectadas al modal estático con botellas abiertas.
 *
 * BUG-5: exportFullData() no existía aunque el sidebar la llama.
 *   CORRECCIÓN: Implementada.
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

// ── Lazy render (evita circularidad de importación) ─────────────
const _render = () => import('./render.js').then(m => m.renderTab()).catch(() => {});

// ── Guardar + sync + render en una sola llamada ─────────────────
function _commit() {
    saveToLocalStorage();
    _render();
    if (state.syncEnabled && window._db && navigator.onLine) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

// ── Estado del modal de producto (qué ID se está editando) ──────
let _editingProductId = null;

// ── Estado del modal de inventario ─────────────────────────────
let _invProductId = null;
let _invArea      = null;

// ══════════════════════════════════════════════════════════════
// HELPER: abrir/cerrar modal estático genérico
// ══════════════════════════════════════════════════════════════
function _showModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function _hideModal(id)  { document.getElementById(id)?.classList.add('hidden'); }
function _el(id)         { return document.getElementById(id); }

// ══════════════════════════════════════════════════════════════
// MODAL DE PRODUCTO — usa #productModal del HTML
// ══════════════════════════════════════════════════════════════

/**
 * Abre el modal de producto (alta o edición).
 * Usa el modal estático #productModal que ya existe en index.html.
 */
function openProductModal(productId = null) {
    if (state.userRole !== 'admin') {
        showNotification('⛔ Solo el administrador puede modificar productos');
        return;
    }

    _editingProductId = productId || null;
    const isEdit  = !!productId;
    const product = isEdit ? state.products.find(p => p.id === productId) : null;

    if (isEdit && !product) {
        showNotification('⚠️ Producto no encontrado');
        return;
    }

    // Actualizar título del modal
    const titleEl = _el('productModalTitle');
    if (titleEl) titleEl.textContent = isEdit ? '✏️ Editar producto' : '➕ Nuevo producto';

    // Pre-llenar campos con los datos del producto (o vacíos para nuevo)
    const fId  = _el('productId');
    const fName = _el('productName');
    const fUnit = _el('productUnit');
    const fGroup = _el('productGroup');
    const fCap   = _el('productCapacidadMl');
    const fPeso  = _el('productPesoLlenaOz');

    if (fId)   { fId.value   = product?.id   || ''; fId.disabled = isEdit; }
    if (fName)  fName.value  = product?.name  || '';
    if (fGroup) fGroup.value = product?.group || '';
    if (fCap)   fCap.value   = product?.capacidadMl        || '';
    if (fPeso)  fPeso.value  = product?.pesoBotellaLlenaOz || '';

    // Seleccionar la unidad correcta en el <select>
    if (fUnit) {
        fUnit.value = product?.unit || 'Botellas';
        // Si la unidad no está en las opciones, añadirla temporalmente
        if (product?.unit && !Array.from(fUnit.options).find(o => o.value === product.unit)) {
            const opt = document.createElement('option');
            opt.value = product.unit;
            opt.textContent = product.unit;
            fUnit.appendChild(opt);
        }
        fUnit.value = product?.unit || 'Botellas';
    }

    _showModal('productModal');
    setTimeout(() => fName?.focus(), 60);
}

/**
 * closeProductModal — llamada desde index.html onclick="closeProductModal()"
 * BUG-1 FIX: Esta función NO existía → clic en Cancelar no hacía nada.
 */
function closeProductModal() {
    _hideModal('productModal');
    _editingProductId = null;
    // Limpiar campos
    ['productId','productName','productGroup','productCapacidadMl','productPesoLlenaOz']
        .forEach(id => { const el = _el(id); if (el) el.value = ''; });
    const fUnit = _el('productUnit');
    if (fUnit) fUnit.value = 'Botellas';
}

/**
 * saveProduct — llamada desde index.html onclick="saveProduct()"
 * BUG-1 FIX: Esta función NO existía → clic en Guardar no hacía nada.
 */
function saveProduct() {
    const name     = (_el('productName')?.value || '').trim();
    const rawId    = (_el('productId')?.value   || '').trim();
    const unit     = _el('productUnit')?.value  || 'Botellas';
    const group    = (_el('productGroup')?.value || '').trim() || 'General';
    const capRaw   = parseFloat(_el('productCapacidadMl')?.value) || null;
    const pesoRaw  = parseFloat(_el('productPesoLlenaOz')?.value) || null;

    if (!name) {
        showNotification('⚠️ El nombre del producto es obligatorio');
        _el('productName')?.focus();
        return;
    }
    if (name.length < 2) {
        showNotification('⚠️ El nombre debe tener al menos 2 caracteres');
        return;
    }

    if (_editingProductId) {
        // Edición
        updateProduct(_editingProductId, {
            name, unit, group,
            capacidadMl:        capRaw  > 0 ? capRaw  : null,
            pesoBotellaLlenaOz: pesoRaw > 0 ? pesoRaw : null,
        });
    } else {
        // Alta — verificar ID manual si se proporcionó
        if (rawId && state.products.find(p => p.id === rawId)) {
            showNotification(`⚠️ El ID "${rawId}" ya existe`);
            return;
        }
        addProduct({
            id:                 rawId || undefined,
            name, unit, group,
            capacidadMl:        capRaw  > 0 ? capRaw  : null,
            pesoBotellaLlenaOz: pesoRaw > 0 ? pesoRaw : null,
        });
    }

    closeProductModal();
    _commit();
}

function editProduct(id) { openProductModal(id); }

async function deleteProduct(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const ok = await showConfirm(
        `¿Eliminar "${product.name}"?\n\nEsta acción no se puede deshacer.`
    );
    if (!ok) return;

    _deleteProduct(id);
    _commit();
}

async function deleteAllProducts() {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm(
        '¿Eliminar TODOS los productos?\n\nSe borrará el catálogo completo. No se puede deshacer.'
    );
    if (!ok) return;

    state.products                  = [];
    state.inventarioConteo          = {};
    state.auditoriaConteo           = {};
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
        state.cart.push({
            id: product.id, name: product.name,
            unit: product.unit || 'Unidad', quantity: 1,
        });
        showNotification(`🛒 ${product.name} agregado al carrito`);
    }

    saveToLocalStorage();
    _render();
    // Si el modal de pedido está abierto, refrescar la tabla
    if (!_el('orderModal')?.classList.contains('hidden')) {
        _refreshOrderModal();
    }
}

// ══════════════════════════════════════════════════════════════
// MODAL DE PEDIDO — usa #orderModal del HTML
// ══════════════════════════════════════════════════════════════

/**
 * Sincroniza el HTML del modal de pedido con state.cart.
 * BUG-3 FIX: El HTML del modal nunca se actualizaba.
 */
function _refreshOrderModal() {
    const tbody    = _el('orderProductsTable');
    const totalEl  = _el('orderTotal');
    const emptyEl  = _el('emptyCart');
    if (!tbody) return;

    if (state.cart.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (totalEl) totalEl.textContent = 'Total: 0';
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    const totalItems = state.cart.reduce((s, i) => s + i.quantity, 0);
    if (totalEl) totalEl.textContent = `Total: ${totalItems}`;

    tbody.innerHTML = state.cart.map((item, idx) => `
        <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 text-gray-900 text-sm font-medium">${escapeHtml(item.name)}</td>
            <td class="px-4 py-3 text-center text-gray-600 text-sm">${escapeHtml(item.unit || '')}</td>
            <td class="px-4 py-3 text-center">
                <div class="flex items-center justify-center gap-2">
                    <button onclick="window._cartDec(${idx})"
                        style="width:28px;height:28px;border-radius:50%;border:1px solid #e5e7eb;
                               background:#f9fafb;font-size:1rem;cursor:pointer;line-height:1;">−</button>
                    <span class="font-bold text-gray-900 min-w-[24px] text-center">${item.quantity}</span>
                    <button onclick="window._cartInc(${idx})"
                        style="width:28px;height:28px;border-radius:50%;border:1px solid #e5e7eb;
                               background:#f9fafb;font-size:1rem;cursor:pointer;line-height:1;">+</button>
                </div>
            </td>
            <td class="px-4 py-3 text-center">
                <button onclick="window._cartRem(${idx})"
                    style="padding:3px 10px;background:#fee2e2;color:#dc2626;border:none;
                           border-radius:6px;font-size:0.75rem;cursor:pointer;">✕ Quitar</button>
            </td>
        </tr>`).join('');
}

/**
 * openOrderModal — abre #orderModal del HTML y sincroniza el carrito.
 * BUG-2 + BUG-3 FIX: Antes creaba un overlay dinámico y no
 * actualizaba la tabla del HTML.
 */
function openOrderModal() {
    if (state.cart.length === 0) {
        showNotification('🛒 El carrito está vacío — agrega productos primero');
        return;
    }

    // Limpiar campos del pedido anterior
    const fSupplier = _el('orderSupplier');
    const fDate     = _el('orderDeliveryDate');
    const fNote     = _el('orderNote');
    if (fSupplier) fSupplier.value = '';
    if (fDate)     fDate.value     = '';
    if (fNote)     fNote.value     = '';

    // Registrar helpers de cart para los botones de la tabla
    window._cartInc = idx => {
        if (state.cart[idx]) { state.cart[idx].quantity += 1; _refreshOrderModal(); saveToLocalStorage(); }
    };
    window._cartDec = idx => {
        if (state.cart[idx]) {
            state.cart[idx].quantity -= 1;
            if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
            if (state.cart.length === 0) { closeOrderModal(); return; }
            _refreshOrderModal();
            saveToLocalStorage();
        }
    };
    window._cartRem = idx => {
        state.cart.splice(idx, 1);
        if (state.cart.length === 0) { closeOrderModal(); return; }
        _refreshOrderModal();
        saveToLocalStorage();
    };

    _refreshOrderModal();
    _showModal('orderModal');
    setTimeout(() => _el('orderSupplier')?.focus(), 60);
}

/**
 * closeOrderModal — llamada desde index.html onclick="closeOrderModal()"
 * BUG-1 FIX: Esta función NO existía.
 */
function closeOrderModal() {
    _hideModal('orderModal');
    delete window._cartInc;
    delete window._cartDec;
    delete window._cartRem;
    saveToLocalStorage();
    _render();
}

/**
 * createOrder — llamada desde index.html onclick="createOrder()"
 * Lee los campos del modal estático, crea el pedido y lo envía por WhatsApp.
 * BUG-1 FIX: Esta función NO existía.
 */
function createOrder() {
    if (state.cart.length === 0) {
        showNotification('🛒 El carrito está vacío');
        return;
    }

    const supplier     = (_el('orderSupplier')?.value || '').trim() || 'Proveedor';
    const deliveryDate = _el('orderDeliveryDate')?.value || '';
    const note         = (_el('orderNote')?.value || '').trim();
    const fecha        = new Date().toLocaleDateString('es-MX');
    const orderId      = 'PED-' + Date.now();

    const order = {
        id: orderId, supplier, date: fecha,
        deliveryDate: deliveryDate || null,
        note: note || null,
        total:    state.cart.reduce((s, i) => s + i.quantity, 0),
        products: state.cart.map(i => ({ ...i })),
    };

    state.orders.unshift(order);
    if (state.orders.length > 100) state.orders.pop();

    // Construir mensaje de WhatsApp
    const lines = [
        `📦 *Pedido ${orderId}*`,
        `Proveedor: *${supplier}*`,
        `Fecha: ${fecha}`,
        deliveryDate ? `Entrega: ${deliveryDate}` : null,
        '',
        '*Productos:*',
        ...state.cart.map(i => `• ${i.name} (${i.unit || 'Unid'}): *${i.quantity}*`),
        '',
        note ? `📝 Nota: ${note}` : null,
        `Total items: *${order.total}*`,
    ].filter(l => l !== null).join('\n');

    state.cart = [];
    closeOrderModal();
    saveToLocalStorage();
    _render();

    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
    showNotification(`✅ Pedido ${orderId} enviado por WhatsApp`);
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
        ...(order.products || []).map(p => `• ${p.name} (${p.unit || 'Unid'}): *${p.quantity}*`),
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

function switchArea(area) {
    state.selectedArea = area;
    _render();
}

function saveInventory(area) {
    if (!area) area = state.selectedArea;
    const conStock = state.products.filter(p => p.stockByArea?.[area] > 0);
    if (conStock.length === 0) {
        showNotification('⚠️ No hay conteo en esta área para guardar');
        return;
    }

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
        `Fecha: ${inv.date || '—'}`,
        `Usuario: ${inv.usuario || '—'}`, '',
        '*Productos:*',
        ...(inv.products || []).map(p => `• ${p.name}: *${(p.stock||0).toFixed(2)}* ${p.unit||''}`),
        '', `Total unidades: *${(inv.totalProducts || 0).toFixed(2)}*`,
    ].join('\n');

    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

async function deleteInventory(inventoryId) {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm('¿Eliminar este registro?\n\nNo se puede deshacer.');
    if (!ok) return;
    state.inventories = state.inventories.filter(i => i.id !== inventoryId);
    showNotification('🗑️ Registro eliminado');
    _commit();
}

async function resetAllInventario() {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm(
        '¿Resetear TODO el inventario?\n\nSe pondrán en cero todos los conteos. No se puede deshacer.'
    );
    if (!ok) return;

    state.inventarioConteo = {};
    state.products.forEach(p => { p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 }; });
    showNotification('🔄 Inventario reseteado a cero');
    _commit();
}

// ══════════════════════════════════════════════════════════════
// MODAL DE INVENTARIO — usa #inventarioModal del HTML
// ══════════════════════════════════════════════════════════════

/**
 * openInventarioModal — usa el modal estático #inventarioModal del HTML.
 * BUG-4 FIX: Antes creaba un overlay dinámico sin botellas abiertas.
 * Ahora pre-llena el modal con los conteos actuales del producto.
 */
function openInventarioModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const area  = state.selectedArea || 'almacen';
    const modal = _el('inventarioModal');

    if (!modal) {
        showNotification('⚠️ Modal de inventario no encontrado en el HTML');
        return;
    }

    _invProductId = productId;
    _invArea      = area;

    // Configurar título y subtítulo
    const titleEl    = _el('inventarioModalTitle');
    const subtitleEl = _el('inventarioModalSubtitle');
    const hintEl     = _el('inv_abiertasUnidadHint');

    if (titleEl)    titleEl.textContent    = product.name;
    if (subtitleEl) subtitleEl.textContent = `Área: ${AREAS[area] || area}`;
    if (hintEl) {
        hintEl.textContent = product.pesoBotellaLlenaOz
            ? `(oz — llena: ${product.pesoBotellaLlenaOz} oz)`
            : '(oz)';
    }

    // Pre-llenar botellas enteras con el conteo existente
    const enterasInput = _el('inv_enteras');
    if (enterasInput) {
        const currentEnteras =
            state.auditoriaConteo[productId]?.[area]?.enteras ??
            state.inventarioConteo[productId]?.[area]         ??
            product.stockByArea?.[area]                        ?? 0;
        enterasInput.value = String(currentEnteras);
    }

    // Pre-llenar botellas abiertas existentes
    const container = _el('inv_abiertasContainer');
    if (container) {
        container.innerHTML = '';
        const abiertas = state.auditoriaConteo[productId]?.[area]?.abiertas ?? [];
        abiertas.forEach(oz => _addAbiertaRow(container, oz));
    }

    _showModal('inventarioModal');
    setTimeout(() => { enterasInput?.focus(); enterasInput?.select(); }, 60);
}

/** Agrega una fila de peso oz al contenedor de botellas abiertas */
function _addAbiertaRow(container, valorOz = '') {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
    row.innerHTML = `
        <input type="number" min="0" step="0.1" value="${valorOz}"
            placeholder="Peso actual (oz)"
            style="flex:1;padding:8px 10px;background:#f9fafb;
                   border:2px solid #f97316;border-radius:8px;
                   color:#111827;font-size:0.9rem;text-align:center;"
            oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value='';">
        <button type="button"
            onclick="this.parentElement.remove()"
            style="width:30px;height:30px;flex-shrink:0;border-radius:50%;
                   border:none;background:#fee2e2;color:#dc2626;
                   font-size:0.8rem;cursor:pointer;">✕</button>`;
    container.appendChild(row);
    row.querySelector('input')?.focus();
}

/**
 * addAbiertaInModal — llamada desde index.html onclick="addAbiertaInModal()"
 * BUG-1 FIX: Esta función NO existía → el botón "+ Agregar" no hacía nada.
 */
function addAbiertaInModal() {
    const container = _el('inv_abiertasContainer');
    if (container) _addAbiertaRow(container);
}

/**
 * closeInventarioModal — llamada desde index.html onclick="closeInventarioModal()"
 * BUG-1 FIX: Esta función NO existía.
 */
function closeInventarioModal() {
    _hideModal('inventarioModal');
    _invProductId = null;
    _invArea      = null;
}

/**
 * saveInventarioModal — llamada desde index.html onclick="saveInventarioModal()"
 * BUG-1 FIX: Esta función NO existía → Guardar conteo no hacía nada.
 * Guarda enteras + abiertas en auditoriaConteo e inventarioConteo.
 */
function saveInventarioModal() {
    if (!_invProductId || !_invArea) { closeInventarioModal(); return; }

    const productId = _invProductId;
    const area      = _invArea;
    const product   = state.products.find(p => p.id === productId);
    if (!product) { closeInventarioModal(); return; }

    // Leer botellas enteras
    const enteras = Math.max(0, parseFloat(_el('inv_enteras')?.value) || 0);

    // Leer botellas abiertas (validar rango físico)
    const container = _el('inv_abiertasContainer');
    const abiertas  = [];
    const maxOz     = (product.pesoBotellaLlenaOz || 200) + 5; // margen de tolerancia
    let   rangeError = false;

    if (container) {
        container.querySelectorAll('input[type="number"]').forEach(inp => {
            const val = parseFloat(inp.value);
            if (isNaN(val) || val <= 0) return;
            if (val > maxOz) {
                inp.style.borderColor = '#ef4444';
                rangeError = true;
                return;
            }
            inp.style.borderColor = '#f97316';
            abiertas.push(Math.round(val * 100) / 100);
        });
    }

    if (rangeError) {
        showNotification(`⚠️ Algún peso excede ${maxOz} oz — verifica los valores`);
        return;
    }

    // Guardar en auditoriaConteo { enteras, abiertas:[oz...] }
    if (!state.auditoriaConteo[productId])        state.auditoriaConteo[productId] = {};
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

// ══════════════════════════════════════════════════════════════
// EXPORTAR EXCEL
// ══════════════════════════════════════════════════════════════

function exportToExcel(modo = 'INVENTARIO') {
    if (typeof window.XLSX === 'undefined') {
        showNotification('❌ Librería XLSX no disponible — recarga la página');
        return;
    }
    if (modo !== 'INVENTARIO') {
        showNotification(`⚠️ Modo "${modo}" desconocido`);
        return;
    }

    const rows = [
        ['ID', 'Producto', 'Unidad', 'Grupo', 'Almacén', 'Barra 1', 'Barra 2', 'Total'],
        ...state.products.map(p => {
            const { porArea, total } = calcularStockTotal(p.id);
            return [
                p.id, p.name, p.unit || '', p.group || 'General',
                (porArea.almacen || 0).toFixed(4),
                (porArea.barra1  || 0).toFixed(4),
                (porArea.barra2  || 0).toFixed(4),
                total.toFixed(4),
            ];
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
    if (typeof window.XLSX === 'undefined') {
        showNotification('❌ Librería XLSX no disponible');
        return;
    }

    const rows = [['ID','Producto','Unidad','Grupo',
        'Almacén Enteras','Almacén Abiertas',
        'Barra1 Enteras','Barra1 Abiertas',
        'Barra2 Enteras','Barra2 Abiertas','Total']];

    state.products.forEach(p => {
        const row = [p.id, p.name, p.unit || '', p.group || 'General'];
        let total = 0;
        AREA_KEYS.forEach(area => {
            const c        = state.auditoriaConteo[p.id]?.[area];
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

// ══════════════════════════════════════════════════════════════
// EXPORTAR JSON COMPLETO (respaldo)
// BUG-5 FIX: El sidebar llama exportFullData() pero NUNCA existió.
// ══════════════════════════════════════════════════════════════

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

        showNotification(`✅ Respaldo exportado — ${state.products.length} productos`);
    } catch (err) {
        showNotification('❌ Error al exportar: ' + err.message);
        console.error('[Export] Error:', err);
    }
}

// ══════════════════════════════════════════════════════════════
// BINDINGS GLOBALES — window.*
// ══════════════════════════════════════════════════════════════

// Funciones llamadas desde render.js (HTML generado dinámicamente)
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

// BUG-1 FIX: Funciones del HTML estático que NUNCA existieron
window.closeProductModal      = closeProductModal;   // index.html línea 246
window.saveProduct            = saveProduct;          // index.html línea 247
window.closeOrderModal        = closeOrderModal;      // index.html línea 298
window.createOrder            = createOrder;          // index.html línea 299
window.addAbiertaInModal      = addAbiertaInModal;    // index.html línea 324
window.closeInventarioModal   = closeInventarioModal; // index.html línea 329
window.saveInventarioModal    = saveInventarioModal;  // index.html línea 330

console.info('[Actions] ✓ v3.0 — 24 funciones expuestas en window (8 nuevas).');
