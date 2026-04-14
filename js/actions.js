/**
 * js/actions.js — v3.1 (Edición Especial Decimales)
 * ══════════════════════════════════════════════════════════════
 * Actualizaciones:
 * 1. Soporte para cantidades decimales (ej. 0.350 kg).
 * 2. Eliminación de botones +/- para limpieza visual.
 * 3. Título dinámico en WhatsApp basado en el campo Notas.
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

// ─── GESTIÓN DE PRODUCTOS ──────────────────────────────────────

export function openProductModal(productId = null) {
  const modal = document.getElementById('productModal');
  const title = document.getElementById('productModalTitle');
  const form  = document.getElementById('productForm');

  if (!modal || !form) return;

  if (productId) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    title.textContent = 'Editar Producto';
    form.productId.value = p.id;
    form.name.value      = p.name;
    form.unit.value      = p.unit;
    form.group.value     = p.group;
    form.capacidad.value = p.capacidadMl || '';
    form.peso.value      = p.pesoBotellaLlenaOz || '';
  } else {
    title.textContent = 'Nuevo Producto';
    form.reset();
    form.productId.value = '';
  }
  modal.classList.remove('hidden');
}

export function closeProductModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.add('hidden');
}

export async function saveProduct() {
  const form = document.getElementById('productForm');
  const id   = form.productId.value;
  
  const data = {
    name:               form.name.value.trim(),
    unit:               form.unit.value,
    group:              form.group.value,
    capacidadMl:        parseFloat(form.capacidad.value) || null,
    pesoBotellaLlenaOz: parseFloat(form.peso.value)      || null
  };

  if (!data.name) return showNotification('⚠️ El nombre es obligatorio');

  if (id) {
    updateProduct(id, data);
    showNotification('✅ Producto actualizado');
  } else {
    addProduct(data);
    showNotification('✅ Producto creado');
  }
  closeProductModal();
  _render();
}

export async function deleteProduct(id) {
  const ok = await showConfirm('¿Eliminar este producto permanentemente?');
  if (ok) {
    _deleteProduct(id);
    showNotification('🗑️ Producto eliminado');
    _render();
  }
}

export async function deleteAllProducts() {
  const ok = await showConfirm('⚠️ ¿BORRAR TODO EL CATÁLOGO?\nEsta acción no se puede deshacer.');
  if (ok) {
    state.products = [];
    saveToLocalStorage();
    showNotification('💥 Catálogo vaciado');
    _render();
  }
}

// ─── CARRITO Y PEDIDOS (MODIFICADO PARA DECIMALES) ────────────

export function addToCart(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;

  const exists = state.cart.find(item => item.id === productId);
  if (exists) {
    exists.quantity += 1;
  } else {
    state.cart.push({ id: p.id, name: p.name, unit: p.unit, quantity: 1 });
  }
  
  saveToLocalStorage();
  showNotification(`📦 ${p.name} añadido`);
  _render();
}

// Nueva función global para capturar texto manual (decimales)
window._cartSet = (idx, value) => {
  const val = parseFloat(value);
  if (state.cart[idx]) {
    state.cart[idx].quantity = (isNaN(val) || val < 0) ? 0 : val;
    saveToLocalStorage();
    _refreshOrderModal(); // Refrescar solo el contenido del modal
  }
};

export function openOrderModal() {
  const modal = document.getElementById('orderModal');
  if (!modal) return;
  _refreshOrderModal();
  modal.classList.remove('hidden');
}

function _refreshOrderModal() {
  const container = document.getElementById('orderProductsTable');
  if (!container) return;

  if (state.cart.length === 0) {
    container.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500">El carrito está vacío</td></tr>';
    return;
  }

  container.innerHTML = state.cart.map((item, idx) => `
    <tr class="border-b border-gray-100">
      <td class="p-3 text-sm text-gray-900 font-medium">${escapeHtml(item.name)}</td>
      <td class="p-3 text-center">
        <input 
          type="number" 
          step="0.001" 
          value="${item.quantity}" 
          onchange="window._cartSet(${idx}, this.value)"
          class="w-20 text-center font-bold bg-gray-50 border border-gray-200 rounded-lg py-1 focus:ring-2 focus:ring-blue-500 outline-none"
        >
        <div class="text-[10px] text-gray-400 mt-1">${item.unit}</div>
      </td>
      <td class="p-3 text-right">
        <button onclick="window.removeFromCart(${idx})" class="text-red-400 hover:text-red-600">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

window.removeFromCart = (idx) => {
  state.cart.splice(idx, 1);
  saveToLocalStorage();
  _refreshOrderModal();
  _render();
};

export function closeOrderModal() {
  document.getElementById('orderModal').classList.add('hidden');
}

// ─── WHATSAPP Y TÍTULOS PERSONALIZADOS ────────────────────────

export function createOrder() {
  if (state.cart.length === 0) return showNotification('⚠️ El carrito está vacío');

  const supplier = document.getElementById('orderSupplier').value || 'General';
  const note     = document.getElementById('orderNote').value.trim();
  const date     = document.getElementById('orderDeliveryDate').value;
  const orderId  = 'PED-' + Date.now();

  // Lógica de título dinámico solicitada
  const tituloMensaje = note ? `📦 *${note}*` : `📦 *Pedido ${orderId}*`;

  const lines = [
    tituloMensaje,
    `Proveedor: *${supplier}*`,
    `Fecha entrega: *${date || 'No especificada'}*`,
    note && !note.startsWith('PED') ? `Nota: _${note}_` : '',
    '',
    '*PRODUCTOS:*',
  ].filter(l => l !== '');

  state.cart.forEach(item => {
    lines.push(`• ${item.quantity} ${item.unit} — *${item.name}*`);
  });

  const message = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/?text=${message}`, '_blank');

  // Guardar en historial
  state.orders.push({
    id: orderId,
    fecha: new Date().toISOString(),
    proveedor: supplier,
    nota: note,
    productos: [...state.cart]
  });

  state.cart = [];
  saveToLocalStorage();
  closeOrderModal();
  _render();
}

export function shareOrderWhatsApp(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  const tituloMensaje = order.nota ? `📦 *${order.nota}*` : `📦 *Pedido ${order.id}*`;

  const lines = [
    tituloMensaje,
    `Proveedor: *${order.proveedor}*`,
    order.nota && !order.nota.startsWith('PED') ? `Nota: _${order.nota}_` : '',
    '',
    '*PRODUCTOS:*'
  ].filter(l => l !== '');

  order.productos.forEach(item => {
    lines.push(`• ${item.quantity} ${item.unit} — *${item.name}*`);
  });

  const message = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/?text=${message}`, '_blank');
}

// ─── OTRAS FUNCIONES (INVENTARIO Y EXPORTACIÓN) ───────────────

export function deleteOrder(id) {
  state.orders = state.orders.filter(o => o.id !== id);
  saveToLocalStorage();
  _render();
}

export function switchArea(area) {
  state.selectedArea = area;
  saveToLocalStorage();
  _render();
}

export function saveInventory() {
  const items = state.products.map(p => ({
    id: p.id,
    name: p.name,
    stock: state.inventarioConteo[p.id] || { almacen: 0, barra1: 0, barra2: 0 }
  }));
  
  state.inventories.push({
    id: 'INV-' + Date.now(),
    fecha: new Date().toISOString(),
    datos: items
  });

  saveToLocalStorage();
  showNotification('💾 Inventario guardado localmente');
}

export function openInventarioModal(productId, area) {
  // Función puente para el modal de botellas abiertas
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  
  // Aquí se invoca la lógica de audit.js si es necesario
  console.log(`Abriendo conteo para ${p.name} en ${area}`);
}

export function exportFullData() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `BarInventory_Backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

// ─── BINDINGS GLOBALES ─────────────────────────────────────────

window.openProductModal       = openProductModal;
window.closeProductModal      = closeProductModal;
window.saveProduct            = saveProduct;
window.deleteProduct          = deleteProduct;
window.deleteAllProducts      = deleteAllProducts;
window.addToCart              = addToCart;
window.openOrderModal         = openOrderModal;
window.closeOrderModal        = closeOrderModal;
window.createOrder            = createOrder;
window.shareOrderWhatsApp     = shareOrderWhatsApp;
window.deleteOrder            = deleteOrder;
window.switchArea             = switchArea;
window.saveInventory          = saveInventory;
window.openInventarioModal    = openInventarioModal;
window.exportFullData         = exportFullData;

console.info('[Actions] ✓ v3.1 — Decimales y Títulos dinámicos configurados.');
