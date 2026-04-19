/**
 * js/reportes.js — v2.0
 * ══════════════════════════════════════════════════════════════
 * Módulo de reportes publicados.
 *
 * CAMBIOS v2.0:
 * ──────────────────────────────────────────────────────────────
 * • publicarReporte() ahora calcula correctamente usando
 *   auditoriaConteoPorUsuario en lugar de inventarioConteo:
 *     - Enteras   = promedio redondeado de todos los usuarios por área
 *     - Oz total  = suma de TODAS las botellas abiertas de todos
 *                   los usuarios por área
 *     - Total     = enteras_avg + conversión de oz a fracción de botella
 *     - Estado    = "Conversión realizada" si tiene capacidadMl Y
 *                   pesoBotellaLlenaOz, sino "Falta datos de conversión"
 *
 * • descargarReporteExcel() ahora genera el formato EXACTO:
 *     Hoja "Auditoría"
 *     Columnas fijas: ID, Nombre, Unidad, Grupo, CapacidadML, PesoBotellaOz
 *     Por cada área: Enteras, Oz Abiertas, Total
 *     Total General, Estado
 *     Subtotales por categoría (Grupo)
 *     Gran Total al final
 *     Estilos básicos (cabeceras coloreadas, subtotales en negrita)
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { AREA_KEYS, AREAS }             from './constants.js';
import { showNotification, escapeHtml } from './ui.js';
import { tieneConversion }              from './products.js';
import { enviarNotificacion }           from './notificaciones.js';
import { PESO_BOTELLA_VACIA_OZ }        from './constants.js';

// ═════════════════════════════════════════════════════════════
//  CÁLCULO MULTIUSUARIO CONSOLIDADO
// ═════════════════════════════════════════════════════════════

/**
 * Calcula el total consolidado de un producto en un área,
 * considerando TODOS los conteos de todos los usuarios.
 *
 * @returns {{ enteras: number, ozAbiertas: number, total: number }}
 */
function _calcConsolidado(product, area) {
    const porUsuario = state.auditoriaConteoPorUsuario[product.id]?.[area];

    // — Fallback: si no hay datos multiusuario, usar auditoriaConteo —
    if (!porUsuario || Object.keys(porUsuario).length === 0) {
        const conteoSimple = state.auditoriaConteo[product.id]?.[area];
        if (!conteoSimple) return { enteras: 0, ozAbiertas: 0, total: 0 };

        const enteras  = typeof conteoSimple.enteras === 'number' ? conteoSimple.enteras : 0;
        const abiertas = Array.isArray(conteoSimple.abiertas) ? conteoSimple.abiertas : [];
        const ozTotal  = abiertas.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
        const total    = _ozAFraccion(product, enteras, abiertas);
        return { enteras, ozAbiertas: Math.round(ozTotal * 1000) / 1000, total };
    }

    // — Multiusuario: promedio de enteras + suma de todas las abiertas —
    const users = Object.values(porUsuario);
    let sumEnteras = 0;
    const todasAbiertas = [];

    users.forEach(u => {
        const ent = typeof u.enteras === 'number' ? u.enteras : 0;
        sumEnteras += ent;
        if (Array.isArray(u.abiertas)) {
            u.abiertas.forEach(oz => {
                if (typeof oz === 'number' && oz > 0) todasAbiertas.push(oz);
            });
        }
    });

    const enterasAvg = users.length > 0 ? Math.round(sumEnteras / users.length) : 0;
    const ozTotal    = todasAbiertas.reduce((s, v) => s + v, 0);
    const total      = _ozAFraccion(product, enterasAvg, todasAbiertas);

    return {
        enteras:    enterasAvg,
        ozAbiertas: Math.round(ozTotal * 1000) / 1000,
        total:      Math.round(total * 10000) / 10000,
    };
}

/**
 * Convierte enteras + array de pesos oz a total en fracciones de botella.
 */
function _ozAFraccion(product, enteras, abiertasArr) {
    if (!Array.isArray(abiertasArr) || abiertasArr.length === 0) return enteras;

    const pesoLlena = product.pesoBotellaLlenaOz || 0;
    const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;

    if (pesoLlena <= pesoVacia) {
        // Sin datos de conversión: contar cada botella abierta como 0.5
        return enteras + abiertasArr.length * 0.5;
    }

    const contenido = pesoLlena - pesoVacia;
    let fraccion = 0;
    abiertasArr.forEach(oz => {
        const p = parseFloat(oz) || 0;
        if      (p <= pesoVacia) fraccion += 0;
        else if (p >= pesoLlena) fraccion += 1;
        else    fraccion += (p - pesoVacia) / contenido;
    });
    return parseFloat((enteras + fraccion).toFixed(4));
}

/** Estado del producto en el reporte */
function _estadoProducto(product) {
    const tieneCapacidad = product.capacidadMl  && product.capacidadMl  > 0;
    const tienePeso      = product.pesoBotellaLlenaOz && product.pesoBotellaLlenaOz > 0;
    if (tieneCapacidad && tienePeso) return 'Conversión realizada';
    const falta = [];
    if (!tieneCapacidad) falta.push('CapacidadMl');
    if (!tienePeso)      falta.push('PesoBotellaLlenaOz');
    return `Falta: ${falta.join(', ')}`;
}

// ═════════════════════════════════════════════════════════════
//  MODAL DE PUBLICACIÓN (admin)
// ═════════════════════════════════════════════════════════════

export function openPublicarReporteModal() {
    if (state.userRole !== 'admin') {
        showNotification('⚠️ Solo el administrador puede publicar reportes');
        return;
    }

    const fecha = new Date().toLocaleDateString('es-MX');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease both;';

    const totalProductos    = state.products.length;
    const areasCompletadas  = Object.values(state.auditoriaStatus || {}).filter(s => s === 'completada').length;
    const totalUsuarios     = Object.keys(state.auditUserRegistry || {}).length;

    overlay.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border-mid);border-radius:var(--r-lg);
                    padding:24px 24px 20px;max-width:400px;width:90%;box-shadow:var(--shadow-modal);">
            <p style="font-weight:600;font-size:0.95rem;color:var(--txt-primary);margin:0 0 4px;">
                📊 Publicar reporte final
            </p>
            <p style="font-size:0.75rem;color:var(--txt-muted);margin:0 0 16px;">
                Los usuarios podrán descargarlo desde "Historia".
            </p>

            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
                        padding:10px 14px;margin-bottom:16px;font-size:0.78rem;color:var(--txt-secondary);">
                <div>📦 ${totalProductos} producto(s)</div>
                <div style="margin-top:3px;">🗺️ ${areasCompletadas}/3 áreas completadas</div>
                <div style="margin-top:3px;">👥 ${totalUsuarios} bartender(s) registrados</div>
            </div>

            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:.07em;
                              text-transform:uppercase;color:var(--txt-secondary);margin-bottom:5px;">
                    Título del reporte
                </label>
                <input id="_rp_titulo" type="text" value="Reporte ${fecha}"
                    style="width:100%;padding:8px 10px;background:var(--surface);
                           border:1px solid var(--border-mid);border-radius:var(--r-md);
                           color:var(--txt-primary);font-size:0.85rem;box-sizing:border-box;">
            </div>

            <div style="display:flex;gap:10px;">
                <button id="_rp_cancel" style="flex:1;padding:9px 0;background:transparent;
                    border:1px solid var(--border-mid);border-radius:var(--r-md);
                    color:var(--txt-secondary);font-size:0.82rem;cursor:pointer;">
                    Cancelar
                </button>
                <button id="_rp_ok" style="flex:2;padding:9px 0;
                    background:linear-gradient(135deg,#065f46,#047857);
                    border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
                    color:#86efac;font-size:0.82rem;font-weight:600;cursor:pointer;">
                    📊 Publicar y notificar
                </button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    document.getElementById('_rp_cancel').onclick = close;
    document.getElementById('_rp_ok').onclick = async () => {
        const titulo = document.getElementById('_rp_titulo').value.trim();
        close();
        await publicarReporte(titulo);
    };
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    setTimeout(() => {
        const inp = document.getElementById('_rp_titulo');
        inp?.focus(); inp?.select();
    }, 60);
}

// ═════════════════════════════════════════════════════════════
//  PUBLICAR REPORTE (admin) — v2.0 MULTIUSUARIO CORRECTO
// ═════════════════════════════════════════════════════════════

export async function publicarReporte(titulo = '') {
    if (state.userRole !== 'admin') {
        showNotification('⚠️ Solo el administrador puede publicar reportes');
        return;
    }
    if (!window._db) { showNotification('⚠️ Firebase no disponible'); return; }

    const fecha       = new Date().toLocaleDateString('es-MX');
    const tituloFinal = titulo || `Reporte ${fecha}`;

    // Construir datos consolidados usando cálculo multiusuario correcto
    const productos = state.products.map(p => {
        const areas = {};
        let totalLlenas   = 0;
        let totalOzGlobal = 0;
        let totalGeneral  = 0;

        AREA_KEYS.forEach(area => {
            const { enteras, ozAbiertas, total } = _calcConsolidado(p, area);
            areas[area] = { enteras, ozAbiertas, total };
            totalLlenas    += enteras;
            totalOzGlobal  += ozAbiertas;
            totalGeneral   += total;
        });

        const totalMl = (p.capacidadMl && p.capacidadMl > 0)
            ? Math.round(totalGeneral * p.capacidadMl)
            : null;

        return {
            id:                  p.id,
            nombre:              p.name,
            unidad:              p.unit || '',
            grupo:               p.group || 'General',
            capacidadMl:         p.capacidadMl || null,
            pesoBotellaLlenaOz:  p.pesoBotellaLlenaOz || null,
            areas,
            totalLlenas:         Math.round(totalLlenas),
            totalOzAbiertas:     Math.round(totalOzGlobal * 1000) / 1000,
            totalGeneral:        Math.round(totalGeneral * 10000) / 10000,
            totalMl,
            estado:              _estadoProducto(p),
        };
    });

    const reporte = {
        titulo:           tituloFinal,
        fecha,
        timestamp:        Date.now(),
        publicadoPor:     state.currentUser?.email || 'admin',
        docId:            window.FIRESTORE_DOC_ID,
        totalProductos:   productos.length,
        totalUsuarios:    Object.keys(state.auditUserRegistry || {}).length,
        productos,
        auditoriaStatus:  { ...state.auditoriaStatus },
        auditUserRegistry: { ...state.auditUserRegistry },
    };

    try {
        showNotification('☁️ Publicando reporte…');
        const docRef = await window._db.collection('reportesPublicados').add(reporte);
        reporte._id  = docRef.id;

        // Broadcast a todos los usuarios
        await enviarNotificacion({
            tipo:        'reporte',
            mensaje:     `📊 Nuevo reporte disponible: "${tituloFinal}"`,
            usuarioId:   'broadcast',
            usuarioName: 'Sistema',
            datos:       { reporteId: docRef.id, titulo: tituloFinal },
        });

        showNotification(`✅ "${tituloFinal}" publicado y notificado`);
        import('./render.js').then(m => m.renderTab());

    } catch (err) {
        console.error('[Reportes] Error al publicar:', err.message);
        showNotification('⚠️ Error al publicar reporte');
    }
}

// ═════════════════════════════════════════════════════════════
//  DESCARGAR REPORTE EXCEL — FORMATO EXACTO v2.0
// ═════════════════════════════════════════════════════════════

export function descargarReporteExcel(reporteId) {
    const reporte = (state.reportesPublicados || []).find(
        r => r._id === reporteId || r.id === reporteId
    );
    if (!reporte) { showNotification('⚠️ Reporte no encontrado'); return; }
    if (!window.XLSX) { showNotification('⚠️ Librería Excel no disponible'); return; }

    _generarExcelAuditoria(reporte, reporte.titulo || 'Reporte');
}

/**
 * Genera el Excel de auditoría con el formato exacto especificado:
 *   Hoja "Auditoría"
 *   Encabezados: ID, Nombre, Unidad, Grupo, CapacidadML, PesoBotellaOz
 *   Por área: Enteras, Oz Abiertas, Total
 *   Total General, Estado
 *   Subtotales por Grupo al final
 *   Gran Total
 */
function _generarExcelAuditoria(reporte, tituloArchivo) {
    const XLSX = window.XLSX;

    // ── Encabezados ───────────────────────────────────────────
    const headerBase  = ['ID', 'Nombre', 'Unidad', 'Grupo', 'CapacidadML', 'PesoBotellaOz'];
    const headerAreas = [];
    AREA_KEYS.forEach(area => {
        const label = AREAS[area] || area;
        headerAreas.push(`${label} Enteras`, `${label} Oz Abiertas`, `${label} Total`);
    });
    const headerEnd = ['Total General', 'Estado'];
    const headerRow = [...headerBase, ...headerAreas, ...headerEnd];

    const aoa = [headerRow]; // array of arrays

    // ── Datos por producto agrupados ──────────────────────────
    // Agrupar productos por Grupo
    const grupos = {};
    (reporte.productos || []).forEach(p => {
        const g = p.grupo || 'General';
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(p);
    });

    // Totales globales para Gran Total
    const granTotalArea = {};
    AREA_KEYS.forEach(a => { granTotalArea[a] = { enteras: 0, oz: 0, total: 0 }; });
    let granTotalGeneral = 0;

    // Para cada grupo
    Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0])).forEach(([grupo, prods]) => {
        // Subtotal del grupo
        const subArea = {};
        AREA_KEYS.forEach(a => { subArea[a] = { enteras: 0, oz: 0, total: 0 }; });
        let subTotal = 0;

        prods.forEach(p => {
            const rowData = [p.id, p.nombre, p.unidad, p.grupo,
                             p.capacidadMl ?? '', p.pesoBotellaLlenaOz ?? ''];
            AREA_KEYS.forEach(area => {
                const d = (p.areas || {})[area] || { enteras: 0, ozAbiertas: 0, total: 0 };
                const enteras   = d.enteras   ?? 0;
                const ozAb      = d.ozAbiertas ?? d.abiertas ?? 0;
                const total     = d.total     ?? 0;
                rowData.push(enteras, ozAb, total);
                subArea[area].enteras += enteras;
                subArea[area].oz      += ozAb;
                subArea[area].total   += total;
                granTotalArea[area].enteras += enteras;
                granTotalArea[area].oz      += ozAb;
                granTotalArea[area].total   += total;
            });
            rowData.push(p.totalGeneral ?? 0, p.estado ?? '');
            subTotal       += p.totalGeneral ?? 0;
            granTotalGeneral += p.totalGeneral ?? 0;
            aoa.push(rowData);
        });

        // Fila de subtotal del grupo
        const subRow = ['', `★ ${grupo.toUpperCase()}`, '', '', '', ''];
        AREA_KEYS.forEach(area => {
            subRow.push(
                Math.round(subArea[area].enteras),
                Math.round(subArea[area].oz * 1000) / 1000,
                Math.round(subArea[area].total * 100) / 100
            );
        });
        subRow.push(Math.round(subTotal * 100) / 100, '');
        aoa.push(subRow);

        // Fila vacía de separación
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

    // ── Crear hoja y workbook ─────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // ── Anchos de columna ─────────────────────────────────────
    const colWidths = [
        { wch: 10 }, // ID
        { wch: 28 }, // Nombre
        { wch: 10 }, // Unidad
        { wch: 18 }, // Grupo
        { wch: 12 }, // CapacidadML
        { wch: 14 }, // PesoBotellaOz
    ];
    AREA_KEYS.forEach(() => {
        colWidths.push({ wch: 10 }, { wch: 12 }, { wch: 10 });
    });
    colWidths.push({ wch: 13 }, { wch: 30 }); // Total General, Estado
    ws['!cols'] = colWidths;

    // ── Estilos básicos (XLSX no soporta estilos sin xlsx-style) ─
    // Marcamos filas de subtotal con '★' en nombre — ya lo tienen

    // ── Nombre de hoja seguro ─────────────────────────────────
    const sheetName = 'Auditoría';

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // ── Segunda hoja: Resumen ─────────────────────────────────
    const resumenAoa = [
        ['REPORTE DE AUDITORÍA FÍSICA CIEGA'],
        [''],
        ['Título', reporte.titulo || ''],
        ['Fecha', reporte.fecha || ''],
        ['Publicado por', reporte.publicadoPor || ''],
        ['Total productos', reporte.totalProductos || 0],
        ['Bartenders', reporte.totalUsuarios || 0],
        [''],
        ['Estado de áreas'],
    ];
    AREA_KEYS.forEach(area => {
        const st = (reporte.auditoriaStatus || {})[area];
        resumenAoa.push([AREAS[area], st === 'completada' ? '✓ Completada' : '⏳ Pendiente']);
    });
    if (reporte.auditUserRegistry) {
        resumenAoa.push([''], ['Bartenders participantes'], ['Usuario', 'Última actividad']);
        Object.entries(reporte.auditUserRegistry).forEach(([uid, reg]) => {
            const lastSeen = reg.lastSeen
                ? new Date(reg.lastSeen).toLocaleString('es-MX')
                : '—';
            resumenAoa.push([reg.userName || uid, lastSeen]);
        });
    }
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenAoa);
    wsResumen['!cols'] = [{ wch: 25 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    // ── Exportar ──────────────────────────────────────────────
    const safeTitle = (reporte.titulo || 'auditoria')
        .replace(/[:\\/?*[\]]/g, '').slice(0, 30);
    const safeDate  = (reporte.fecha || new Date().toLocaleDateString('es-MX'))
        .replace(/\//g, '-');
    const filename  = `AUDITORIA_${safeTitle}_${safeDate}.xlsx`;

    XLSX.writeFile(wb, filename);
    showNotification('✅ Excel de auditoría descargado');
}

// ═════════════════════════════════════════════════════════════
//  LISTENER FIRESTORE
// ═════════════════════════════════════════════════════════════

export function suscribirReportesPublicados() {
    if (!window._db) return () => {};

    const unsub = window._db.collection('reportesPublicados')
        .where('docId', '==', window.FIRESTORE_DOC_ID)
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot(
            snap => {
                state.reportesPublicados = [];
                snap.forEach(doc => state.reportesPublicados.push({ _id: doc.id, ...doc.data() }));
                import('./render.js').then(m => m.renderTab()).catch(() => {});
            },
            err => console.warn('[Reportes] Error en listener:', err.message)
        );

    return unsub;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: LISTA DE REPORTES PUBLICADOS
// ═════════════════════════════════════════════════════════════

export function renderReportesPublicados() {
    const reportes = state.reportesPublicados || [];

    if (reportes.length === 0) {
        return `<div style="padding:24px;text-align:center;">
            <div style="font-size:2rem;margin-bottom:8px;">📊</div>
            <p style="font-size:0.8rem;color:var(--txt-muted);">Sin reportes publicados</p>
        </div>`;
    }

    let html = '<div class="space-y-2">';
    reportes.forEach((r, idx) => {
        const delay = Math.min(idx * 40, 300);
        const areasStatus = AREA_KEYS.map(a => {
            const st = (r.auditoriaStatus || {})[a];
            return st === 'completada'
                ? `<span style="font-size:0.60rem;font-weight:700;padding:1px 7px;border-radius:3px;
                               background:var(--green-dim);color:var(--green-text);
                               border:1px solid rgba(34,197,94,.20);">✓ ${AREAS[a]}</span>`
                : `<span style="font-size:0.60rem;padding:1px 7px;border-radius:3px;
                               background:rgba(148,163,184,.10);color:var(--txt-muted);">
                               ${AREAS[a]}</span>`;
        }).join('');

        html += `<div class="bg-white rounded-xl p-4 shadow-md"
            style="animation:cardIn 0.2s ease-out ${delay}ms both;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.83rem;color:var(--txt-primary);">
                        📊 ${escapeHtml(r.titulo)}
                    </div>
                    <div style="font-size:0.7rem;color:var(--txt-muted);margin-top:3px;">
                        ${escapeHtml(r.fecha)} · ${r.totalProductos || 0} productos
                        ${r.totalUsuarios ? ` · ${r.totalUsuarios} bartenders` : ''}
                        · Por ${escapeHtml(r.publicadoPor || '—')}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                        ${areasStatus}
                    </div>
                </div>
                <button data-id="${escapeHtml(r._id)}"
                    onclick="window.descargarReporteExcel(this.dataset.id)"
                    style="padding:7px 12px;background:linear-gradient(135deg,#065f46,#047857);
                           border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
                           color:#86efac;font-size:0.72rem;font-weight:600;cursor:pointer;
                           flex-shrink:0;white-space:nowrap;min-height:auto;">
                    ⬇️ Excel
                </button>
            </div>
        </div>`;
    });
    html += '</div>';
    return html;
}

// ─── Bindings globales ────────────────────────────────────────
window.openPublicarReporteModal = openPublicarReporteModal;
window.descargarReporteExcel    = descargarReporteExcel;
