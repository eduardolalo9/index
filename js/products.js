/**
 * js/products.js — v2.3 CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * FIX BUG-6: ajustarProducto() llamaba enviarNotificacionAjuste()
 *   que NO existe en notificaciones.js.
 *   La función correcta es enviarNotificacion().
 *   El optional chaining ?.() evitaba el crash, pero la notificación
 *   nunca llegaba al admin cuando un usuario solicitaba un ajuste.
 * ══════════════════════════════════════════════════════════════
 */

import { state }                from './state.js';
import { showNotification }     from './ui.js';
import { saveToLocalStorage }   from './storage.js';
import { PESO_BOTELLA_VACIA_OZ,
         AREA_KEYS }            from './constants.js';

// ═════════════════════════════════════════════════════════════
// HELPER: parsear números de Excel
// ═════════════════════════════════════════════════════════════

export function parseExcelNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  let str = String(value).trim().replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d+$/.test(str)) {
    str = str.replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// ═════════════════════════════════════════════════════════════
// CRUD
// ═════════════════════════════════════════════════════════════

export function getProductById(id) {
  return state.products.find(p => p.id === id);
}

export function getUniqueGroups() {
  const groups = new Set(state.products.map(p => p.group || 'General'));
  return ['Todos', ...Array.from(groups).sort()];
}

export function getProductsByGroup(group = 'Todos') {
  if (group === 'Todos') return [...state.products];
  return state.products.filter(p => (p.group || 'General') === group);
}

export function filterByGroup() {
  let products = getProductsByGroup(state.selectedGroup || 'Todos');
  const term = (state.searchTerm || '').toLowerCase().trim();
  if (term) {
    products = products.filter(p =>
      (p.name  || '').toLowerCase().includes(term) ||
      (p.id    || '').toLowerCase().includes(term) ||
      (p.group || '').toLowerCase().includes(term) ||
      (p.unit  || '').toLowerCase().includes(term)
    );
  }
  return products;
}

export function getAvailableGroups() { return getUniqueGroups(); }

export function getTotalStock(product) {
  if (!product) return 0;
  if (product.stockByArea) {
    let total = 0;
    AREA_KEYS.forEach(area => { total += parseFloat(product.stockByArea[area] || 0); });
    return parseFloat(total.toFixed(4));
  }
  return calcularStockTotal(product.id).total;
}

export function addProduct(productData) {
  let maxNum = 0;
  state.products.forEach(p => {
    const m = String(p.id).match(/^PRD-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  // Respetar ID manual si se proporcionó y no está duplicado
  const rawId = productData.id ? String(productData.id).trim() : '';
  const id = (rawId && !state.products.find(p => p.id === rawId))
    ? rawId
    : 'PRD-' + String(maxNum + 1).padStart(3, '0');

  const product = {
    id,
    name:        (productData.name  || 'Sin nombre').trim(),
    unit:        (productData.unit  || 'Unidad').trim(),
    group:       (productData.group || 'General').trim(),
    stockByArea: { almacen: 0, barra1: 0, barra2: 0 },
  };
  if (productData.capacidadMl > 0)        product.capacidadMl        = parseFloat(productData.capacidadMl);
  if (productData.pesoBotellaLlenaOz > 0) product.pesoBotellaLlenaOz = parseFloat(productData.pesoBotellaLlenaOz);

  state.products.push(product);
  saveToLocalStorage();
  showNotification(`✅ Producto "${product.name}" agregado`);
  console.info('[Products] Creado:', id, product.name);
  return product;
}

export function updateProduct(id, updates) {
  const product = state.products.find(p => p.id === id);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return null; }
  if (updates.name  !== undefined) product.name  = String(updates.name).trim();
  if (updates.unit  !== undefined) product.unit  = String(updates.unit).trim();
  if (updates.group !== undefined) product.group = String(updates.group).trim();
  if (updates.capacidadMl        !== undefined) product.capacidadMl        = parseFloat(updates.capacidadMl)        || null;
  if (updates.pesoBotellaLlenaOz !== undefined) product.pesoBotellaLlenaOz = parseFloat(updates.pesoBotellaLlenaOz) || null;
  if (updates.stockByArea) product.stockByArea = { ...product.stockByArea, ...updates.stockByArea };
  saveToLocalStorage();
  showNotification(`✅ "${product.name}" actualizado`);
  return product;
}

export function deleteProduct(id) {
  const index = state.products.findIndex(p => p.id === id);
  if (index === -1) { showNotification('⚠️ Producto no encontrado'); return false; }
  const name = state.products[index].name;
  state.products.splice(index, 1);
  delete state.inventarioConteo[id];
  delete state.auditoriaConteo[id];
  delete state.auditoriaConteoPorUsuario[id];
  saveToLocalStorage();
  // FIX R-06: limpiar datos del producto en subcollecciones de Firestore.
  // Antes los datos huérfanos quedaban para siempre en stockAreas,
  // conteoAreas y conteoPorUsuario, aumentando el costo y el tamaño.
  if (window._db && navigator.onLine && window.FIRESTORE_DOC_ID) {
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const batch  = window._db.batch();
    const AREA_KEYS_LOCAL = ['almacen', 'barra1', 'barra2'];
    ['stockAreas', 'conteoAreas'].forEach(subcoll => {
      AREA_KEYS_LOCAL.forEach(area => {
        const ref = docRef.collection(subcoll).doc(area);
        // update con dot-notation para borrar solo el campo del producto
        // sin tocar los demás productos del mismo documento de área
        batch.update(ref, { [id]: firebase?.firestore?.FieldValue?.delete() || null })
             .catch?.(() => {});
      });
    });
    AREA_KEYS_LOCAL.forEach(area => {
      const ref = docRef.collection('conteoPorUsuario').doc(area);
      batch.update(ref, { [id]: firebase?.firestore?.FieldValue?.delete() || null })
           .catch?.(() => {});
    });
    batch.commit().catch(e =>
      console.warn('[Products] Cleanup Firestore falló (no crítico):', e?.message)
    );
  }
  showNotification(`🗑️ "${name}" eliminado`);
  return true;
}

export function tieneConversion(product) {
  return !!(product && product.capacidadMl && product.capacidadMl > 0);
}

// ═════════════════════════════════════════════════════════════
// CÁLCULOS DE STOCK
// ═════════════════════════════════════════════════════════════

export function calcularTotalConAbiertas(productId, area) {
  const product = getProductById(productId);
  if (!product) return 0;

  const conteo = state.auditoriaConteo[productId]?.[area];
  if (!conteo) return product.stockByArea?.[area] || 0;

  const enteras  = typeof conteo.enteras === 'number' ? conteo.enteras : 0;
  const abiertas = Array.isArray(conteo.abiertas) ? conteo.abiertas : [];
  if (abiertas.length === 0) return enteras;

  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;
  if (pesoLlena <= pesoVacia) return enteras + (abiertas.length * 0.5);

  const contenidoLlena = pesoLlena - pesoVacia;
  let totalAbiertas = 0;
  abiertas.forEach(pesoActual => {
    const peso = parseFloat(pesoActual) || 0;
    if      (peso <= pesoVacia) totalAbiertas += 0;
    else if (peso >= pesoLlena) totalAbiertas += 1;
    else    totalAbiertas += (peso - pesoVacia) / contenidoLlena;
  });
  return parseFloat((enteras + totalAbiertas).toFixed(4));
}

export function calcularContenidoMl(productId, area) {
  const product = getProductById(productId);
  if (!product || !product.capacidadMl) return 0;
  return parseFloat((calcularTotalConAbiertas(productId, area) * product.capacidadMl).toFixed(2));
}

export function calcularStockTotal(productId) {
  const porArea = {};
  let total = 0;
  AREA_KEYS.forEach(area => {
    const val = calcularTotalConAbiertas(productId, area);
    porArea[area] = val;
    total += val;
  });
  const product = getProductById(productId);
  const totalMl = product?.capacidadMl
    ? parseFloat((total * product.capacidadMl).toFixed(2)) : 0;
  return { total: parseFloat(total.toFixed(4)), porArea, totalMl };
}

export function calcularTotalMultiUsuario(productId, area) {
  const product = getProductById(productId);
  if (!product) return 0;
  const porUsuario = state.auditoriaConteoPorUsuario[productId]?.[area];
  if (!porUsuario || Object.keys(porUsuario).length === 0) {
    return calcularTotalConAbiertas(productId, area);
  }
  // FIX-2: antes usaba maxEnteras (el conteo más alto entre usuarios),
  // lo que inflaba el inventario real. Ahora usa el promedio redondeado,
  // que es el valor consensuado entre todos los bartenders que contaron.
  let sumEnteras = 0, contadoresCount = 0, todasAbiertas = [];
  Object.values(porUsuario).forEach(conteo => {
    if (typeof conteo === 'object' && conteo !== null) {
      const ent = typeof conteo.enteras === 'number' ? conteo.enteras : 0;
      sumEnteras += ent;
      contadoresCount++;
      if (Array.isArray(conteo.abiertas)) todasAbiertas = todasAbiertas.concat(conteo.abiertas);
    }
  });
  // Promedio redondeado al entero más cercano (enteras siempre son unidades completas)
  const avgEnteras = contadoresCount > 0 ? Math.round(sumEnteras / contadoresCount) : 0;
  if (todasAbiertas.length === 0) return avgEnteras;
  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;
  if (pesoLlena <= pesoVacia) return avgEnteras + (todasAbiertas.length * 0.5);
  const contenidoLlena = pesoLlena - pesoVacia;
  let totalAbiertas = 0;
  todasAbiertas.forEach(pesoActual => {
    const peso = parseFloat(pesoActual) || 0;
    if      (peso <= pesoVacia) totalAbiertas += 0;
    else if (peso >= pesoLlena) totalAbiertas += 1;
    else    totalAbiertas += (peso - pesoVacia) / contenidoLlena;
  });
  return parseFloat((avgEnteras + totalAbiertas).toFixed(4));
}

// ═════════════════════════════════════════════════════════════
// syncStockByAreaFromConteo
// ═════════════════════════════════════════════════════════════

export function syncStockByAreaFromConteo() {
  if (!state.inventarioConteo) return;
  let updated = 0;
  state.products.forEach(product => {
    const conteo = state.inventarioConteo[product.id];
    if (!conteo) return;
    if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    AREA_KEYS.forEach(area => {
      if (conteo[area] !== undefined && conteo[area] !== null) {
        const valor = parseFloat(conteo[area]);
        if (!isNaN(valor)) { product.stockByArea[area] = valor; updated++; }
      }
    });
  });
  if (updated > 0) console.info(`[Products] syncStockByAreaFromConteo: ${updated} campos.`);
}

// ═════════════════════════════════════════════════════════════
// handleFileImport — Importación Excel
// ═════════════════════════════════════════════════════════════

export function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;

  if (state.userRole !== 'admin') {
    showNotification('⛔ Solo el administrador puede importar productos');
    fileInput.value = ''; return;
  }
  if (!['xlsx','xls','csv'].some(ext => file.name.toLowerCase().endsWith('.' + ext))) {
    showNotification('⚠️ Selecciona un archivo Excel (.xlsx, .xls, .csv)');
    fileInput.value = ''; return;
  }
  if (typeof window.XLSX === 'undefined' || !window.XLSX.read) {
    showNotification('❌ Librería XLSX no cargada. Recarga la página.');
    fileInput.value = ''; return;
  }

  const reader = new FileReader();
  reader.onerror = () => { showNotification('❌ Error al leer el archivo'); fileInput.value = ''; };
  reader.onload = function (e) {
    try {
      const workbook = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      if (!workbook.SheetNames?.length) { showNotification('Sin hojas válidas'); fileInput.value = ''; return; }
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) { showNotification('Primera hoja vacía'); fileInput.value = ''; return; }
      const jsonData = window.XLSX.utils.sheet_to_json(sheet);
      if (!jsonData?.length) { showNotification('Sin datos válidos'); fileInput.value = ''; return; }

      const columnMap = {
        id:   ['ID','Id','id','Código','codigo'],
        name: ['Producto','Nombre','Descripción','descripcion','producto','nombre','Name','name','PRODUCTO','NOMBRE'],
        unit:  ['Unidad','unidad','Medida','medida','Unit','UNIDAD'],
        group: ['Grupo','grupo','Categoría','categoria','Group','GRUPO'],
        stock: ['Cantidad','cantidad','Stock','stock','Enteras','CANTIDAD'],
        capacidadMl:        ['CapacidadML','capacidadMl','CapacidadMl','Capacidad_ML','CapML','capacidadML','capacidadml'],
        pesoBotellaLlenaOz: ['PesoBotellaOz','pesoBotellaOz','PesoLlenaOz','PesoOz','pesoBotellaLlenaOz'],
      };
      const findCol = (row, keys) => {
        for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
        const rowKeys = Object.keys(row);
        for (const key of keys) {
          const found = rowKeys.find(rk => rk.toLowerCase() === key.toLowerCase());
          if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') return row[found];
        }
        return undefined;
      };

      const existingIds = new Set(state.products.map(p => p.id));
      let maxNum = 0;
      state.products.forEach(p => { const m = String(p.id).match(/^PRD-(\d+)$/); if (m) maxNum = Math.max(maxNum, parseInt(m[1],10)); });
      let nextNum = maxNum + 1;
      const usedInBatch = new Set();
      const toImport = [];

      jsonData.forEach(row => {
        const name = findCol(row, columnMap.name);
        if (!name || !String(name).trim()) return;
        const rawId = findCol(row, columnMap.id);
        let id = rawId !== undefined ? String(rawId).trim() : '';
        if (!id || existingIds.has(id) || usedInBatch.has(id)) {
          do { id = 'PRD-' + String(nextNum++).padStart(3,'0'); }
          while (existingIds.has(id) || usedInBatch.has(id));
        }
        usedInBatch.add(id);
        const unit  = String(findCol(row, columnMap.unit)  ?? 'Unidad').trim();
        const group = String(findCol(row, columnMap.group) ?? 'General').trim();
        const stock = parseExcelNumber(findCol(row, columnMap.stock) ?? 0);
        const capRaw  = findCol(row, columnMap.capacidadMl);
        const pesoRaw = findCol(row, columnMap.pesoBotellaLlenaOz);
        const capacidadMl        = capRaw  !== undefined ? (isNaN(parseFloat(capRaw))  ? null : parseFloat(capRaw))  : null;
        const pesoBotellaLlenaOz = pesoRaw !== undefined ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw)) : null;
        const product = { id, name: String(name).trim(), unit, group, stockByArea: { almacen: stock, barra1: 0, barra2: 0 } };
        if (capacidadMl        > 0) product.capacidadMl        = capacidadMl;
        if (pesoBotellaLlenaOz > 0) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;
        toImport.push(product);
      });

      if (!toImport.length) { showNotification('⚠️ Sin productos válidos — verifica columnas'); fileInput.value = ''; return; }

      state.products = state.products.concat(toImport);
      const _importTs = Date.now();
      localStorage.setItem('inventarioApp_lastModified', String(_importTs));
      state.activeTab = 'inicio'; state.selectedGroup = 'Todos'; state.searchTerm = ''; state.selectedArea = 'almacen';
      saveToLocalStorage();

      if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => {
          if (typeof m._setLastLocalWriteTs === 'function') m._setLastLocalWriteTs(_importTs);
          m.syncToCloud().catch(() => {});
        }).catch(() => {});
      }

      showNotification(`✅ ${toImport.length} productos importados`);
      import('./render.js').then(m => { m.renderTab(); fileInput.value = ''; }).catch(() => { fileInput.value = ''; });

    } catch (error) {
      showNotification('❌ Error al importar: ' + error.message);
      console.error('[Import]', error);
      fileInput.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═════════════════════════════════════════════════════════════
// importFullData — Importar estado desde JSON
// ═════════════════════════════════════════════════════════════

export function importFullData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;
  if (state.userRole === 'user') { showNotification('⛔ Solo el administrador puede importar datos'); fileInput.value = ''; return; }
  if (!file.name.toLowerCase().endsWith('.json')) { showNotification('⚠️ Selecciona un archivo JSON (.json)'); fileInput.value = ''; return; }

  const reader = new FileReader();
  reader.onerror = () => { showNotification('❌ Error al leer'); fileInput.value = ''; };
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') { showNotification('⚠️ Formato inválido'); fileInput.value = ''; return; }
      if (Array.isArray(data.products))          state.products                  = data.products;
      if (Array.isArray(data.inventories))       state.inventories               = data.inventories;
      if (Array.isArray(data.orders))            state.orders                    = data.orders;
      if (data.inventarioConteo)                 state.inventarioConteo          = data.inventarioConteo;
      if (data.auditoriaConteo)                  state.auditoriaConteo           = data.auditoriaConteo;
      if (data.auditoriaStatus)                  state.auditoriaStatus           = data.auditoriaStatus;
      if (data.auditoriaConteoPorUsuario)        state.auditoriaConteoPorUsuario = data.auditoriaConteoPorUsuario;
      if (data.ajustes)                          state.ajustes                   = data.ajustes;
      syncStockByAreaFromConteo();
      state.activeTab = 'inicio'; state.selectedGroup = 'Todos'; state.searchTerm = '';
      saveToLocalStorage();
      showNotification(`✅ Datos importados: ${state.products.length} productos`);
      import('./render.js').then(m => m.renderTab()).catch(() => {});
      if (state.syncEnabled && window._db && navigator.onLine) import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
      fileInput.value = '';
    } catch (err) {
      showNotification('❌ Error: ' + err.message);
      console.error('[ImportFull]', err);
      fileInput.value = '';
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ═════════════════════════════════════════════════════════════
// ajustarProducto — FIX BUG-6
// ═════════════════════════════════════════════════════════════

export async function ajustarProducto(productId, area, nuevoValor, motivo = '') {
  const product = getProductById(productId);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

  const valorAnterior = product.stockByArea?.[area] || 0;
  if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  product.stockByArea[area] = parseFloat(nuevoValor) || 0;
  saveToLocalStorage();

  if (state.userRole === 'user') {
    try {
      // FIX BUG-6: era 'enviarNotificacionAjuste' (no existe).
      // La función correcta en notificaciones.js es 'enviarNotificacion'.
      const { enviarNotificacion } = await import('./notificaciones.js');
      await enviarNotificacion({
        tipo:        'ajuste',
        mensaje:     `${state.auditCurrentUser?.userName || 'Usuario'} ajustó "${product.name}" [${area}]: ${valorAnterior} → ${nuevoValor}${motivo ? ' — ' + motivo : ''}`,
        usuarioId:   state.currentUser?.uid    || state.auditCurrentUser?.userId   || 'anon',
        usuarioName: state.currentUser?.email  || state.auditCurrentUser?.userName || 'Anónimo',
        productoId:  productId,
        productoName: product.name,
        datos: { area, valorAnterior, nuevoValor, motivo, timestamp: Date.now() },
      });
    } catch (e) {
      console.warn('[Products] Notificación de ajuste falló:', e);
    }
  }

  showNotification(`✅ ${product.name} ajustado en ${AREA_KEYS.includes(area) ? area : 'área'}`);
}

// ═════════════════════════════════════════════════════════════
// finalizarInventario
// ═════════════════════════════════════════════════════════════

export function finalizarInventario() {
  const snapshot = {
    id:       'INV-' + Date.now(),
    fecha:    new Date().toISOString(),
    usuario:  state.auditCurrentUser?.userName || 'Sistema',
    productos: state.products.map(p => ({
      id:            p.id,
      nombre:        p.name,
      grupo:         p.group,
      stockByArea:   { ...p.stockByArea },
      totalUnidades: calcularStockTotal(p.id).total,
      totalMl:       calcularStockTotal(p.id).totalMl,
    })),
  };
  state.inventories.push(snapshot);
  state.inventarioConteo          = {};
  state.auditoriaConteo           = {};
  state.auditoriaConteoPorUsuario = {};
  state.auditoriaStatus = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
  state.products.forEach(p => { p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 }; });
  saveToLocalStorage();
  // FIX R-05: sincronizar inmediatamente. Sin esto el snapshot del inventario
  // solo vivía en localStorage hasta el próximo auto-save (30s).
  // Si el dispositivo se cerraba en esa ventana, el historial se perdía.
  if (state.syncEnabled && window._db && navigator.onLine) {
    import('./sync.js').then(m => m.syncToCloud()).catch(e =>
      console.warn('[Products] syncToCloud tras finalizarInventario falló:', e)
    );
  }
  showNotification('✅ Inventario finalizado y guardado en historial');
  return snapshot;
}

