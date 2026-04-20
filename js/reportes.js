/**
 * js/reportes.js — v2.0
 * ══════════════════════════════════════════════════════════════
 * Módulo de reportes publicados.
 *
 * NUEVO v2.0:
 * ──────────────────────────────────────────────────────────────
 * ① publicarReporte() usa calcularTotalMultiUsuario para
 *   consolidar correctamente los conteos de múltiples bartenders
 *   (promedio de enteras, suma de botellas abiertas).
 *
 * ② descargarReporteExcel() genera el formato EXACTO:
 *   Hoja "Auditoría"
 *   Columnas: ID | Nombre | Unidad | Grupo | CapacidadML | PesoBotellaOz
 *             | [Área Enteras | Área Abiertas (oz) | Área Total] x3
 *             | Total General | Estado
 *   Subtotales por categoría.
 *   Gran Total al final.
 *
 * FLUJO:
 *   Admin → openPublicarReporteModal()
 *     → publicarReporte(titulo)
 *       → Escribe en /reportesPublicados/{id}
 *       → Notifica a todos los usuarios (broadcast)
 *   Usuario → ve sección "Reportes" en Historia
 *     → descargarReporteExcel(reporteId) → .xlsx local
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { AREA_KEYS, AREAS,
         PESO_BOTELLA_VACIA_OZ }        from './constants.js';
import { showNotification, escapeHtml } from './ui.js';
import { calcularTotalConAbiertas,
         calcularTotalMultiUsuario,
         tieneConversion }              from './products.js';
import { enviarNotificacion }           from './notificaciones.js';

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
    const usuariosTotal     = _contarUsuariosConConteo();

    overlay.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border-mid);border-radius:var(--r-lg);
                    padding:24px 24px 20px;max-width:420px;width:90%;box-shadow:var(--shadow-modal);">
            <p style="font-weight:700;font-size:0.95rem;color:var(--txt-primary);margin:0 0 4px;">
                📊 Publicar reporte final
            </p>
            <p style="font-size:0.75rem;color:var(--txt-muted);margin:0 0 16px;">
                El reporte consolidará los conteos de todos los bartenders.<br>
                Los usuarios recibirán notificación y podrán descargar el Excel.
            </p>

            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
                        padding:10px 14px;margin-bottom:16px;font-size:0.78rem;color:var(--txt-secondary);">
                <div>📦 ${totalProductos} producto(s)</div>
                <div style="margin-top:3px;">🗺️ ${areasCompletadas}/3 áreas completadas</div>
                <div style="margin-top:3px;">👥 ${usuariosTotal} bartender(s) con conteos registrados</div>
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
                    📊 Publicar y notificar usuarios
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

function _contarUsuariosConConteo() {
    const uids = new Set();
    Object.values(state.auditoriaConteoPorUsuario).forEach(porProducto => {
        Object.values(porProducto).forEach(porArea => {
            Object.keys(porArea).forEach(uid => uids.add(uid));
        });
    });
    return uids.size;
}

// ═════════════════════════════════════════════════════════════
//  PUBLICAR REPORTE (admin) — v2.0
// ═════════════════════════════════════════════════════════════

export async function publicarReporte(titulo = '') {
    if (state.userRole !== 'admin') {
        showNotification('⚠️ Solo el administrador puede publicar reportes');
        return;
    }
    if (!window._db) { showNotification('⚠️ Firebase no disponible'); return; }

    const fecha       = new Date().toLocaleDateString('es-MX');
    const tituloFinal = titulo || `Reporte ${fecha}`;

    // ── Construir datos consolidados ──────────────────────────
    const productos = state.products.map(p => {
        const areas = {};
        let totalLlenas   = 0;
        let totalOzAbiertas = 0;

        AREA_KEYS.forEach(area => {
            // Datos del conteo consolidado (multi-usuario)
            const porUsuario = state.auditoriaConteoPorUsuario[p.id]?.[area] || {};
            const usuarios   = Object.values(porUsuario);

            let enteras, abiertasCount, totalOzArea;

            if (usuarios.length > 0) {
                // Promedio de enteras (redondeado)
                const sumEnteras = usuarios.reduce((s, u) => s + (u.enteras || 0), 0);
                enteras = Math.round(sumEnteras / usuarios.length);

                // Suma total de oz (todas las botellas abiertas de todos los usuarios)
                totalOzArea = 0;
                abiertasCount = 0;
                usuarios.forEach(u => {
                    if (Array.isArray(u.abiertas)) {
                        abiertasCount += u.abiertas.length;
                        totalOzArea   += u.abiertas.reduce((s, v) => s + (parseFloat(v) || 0), 0);
                    }
                });
                totalOzArea = Math.round(totalOzArea * 100) / 100;
            } else {
                // Fallback: auditoriaConteo del dispositivo local
                const c    = state.auditoriaConteo[p.id]?.[area] || {};
                enteras    = c.enteras || 0;
                const abArr = Array.isArray(c.abiertas) ? c.abiertas : [];
                abiertasCount = abArr.length;
                totalOzArea   = Math.round(abArr.reduce((s, v) => s + (parseFloat(v) || 0), 0) * 100) / 100;
            }

            // Total consolidado (usa calcularTotalMultiUsuario si hay multi-usuario,
            // sino calcularTotalConAbiertas como fallback)
            const total = usuarios.length > 0
                ? Math.round((calcularTotalMultiUsuario(p.id, area) || 0) * 10000) / 10000
                : Math.round((calcularTotalConAbiertas(p.id, area) || 0) * 10000) / 10000;

            areas[area] = { enteras, abiertas: abiertasCount, totalOzAbiertas: totalOzArea, total };
            totalLlenas    += enteras;
            totalOzAbiertas += totalOzArea;
        });

        const totalGeneral = Math.round(
            AREA_KEYS.reduce((s, a) => s + (areas[a].total || 0), 0) * 10000
        ) / 10000;

        const totalMl = tieneConversion(p)
            ? Math.round(totalGeneral * p.capacidadMl)
            : null;

        const estado = (p.capacidadMl && p.capacidadMl > 0 && p.pesoBotellaLlenaOz && p.pesoBotellaLlenaOz > 0)
            ? 'Conversión realizada'
            : 'Falta capacidadMl o pesoBotellaLlenaOz';

        return {
            id:              p.id,
            nombre:          p.name,
            unidad:          p.unit  || '',
            grupo:           p.group || 'General',
            capacidadMl:     p.capacidadMl        || null,
            pesoBotellaOz:   p.pesoBotellaLlenaOz || null,
            areas,
            totalLlenas,
            totalOzAbiertas: Math.round(totalOzAbiertas * 1000) / 1000,
            totalGeneral,
            totalMl,
            estado,
        };
    });

    const reporte = {
        titulo:          tituloFinal,
        fecha,
        timestamp:       Date.now(),
        publicadoPor:    state.currentUser?.email || 'admin',
        docId:           window.FIRESTORE_DOC_ID,
        totalProductos:  productos.length,
        productos,
        auditoriaStatus: { ...state.auditoriaStatus },
        conteoFinalizadoPorUsuario: state.conteoFinalizadoPorUsuario || {},
    };

    try {
        showNotification('☁️ Publicando reporte…');
        const docRef = await window._db.collection('reportesPublicados').add(reporte);
        reporte._id  = docRef.id;

        // Broadcast a todos los usuarios
        await enviarNotificacion({
            tipo:        'reporte',
            mensaje:     `📊 Nuevo reporte disponible: "${tituloFinal}" — ya puedes descargarlo en Historia`,
            usuarioId:   'broadcast',
            usuarioName: 'Sistema',
            datos:       { reporteId: docRef.id, titulo: tituloFinal },
        });

        showNotification(`✅ "${tituloFinal}" publicado y notificado`);
        import('./render.js').then(m => m.renderTab());

    } catch (err) {
        console.error('[Reportes] Error al publicar:', err.message);
        showNotification('⚠️ Error al publicar reporte: ' + err.message);
    }
}

// ═════════════════════════════════════════════════════════════
//  DESCARGAR REPORTE (admin y usuario) — FORMATO EXACTO v2.0
// ═════════════════════════════════════════════════════════════

export function descargarReporteExcel(reporteId) {
    const reporte = (state.reportesPublicados || []).find(
        r => r._id === reporteId || r.id === reporteId
    );
    if (!reporte) { showNotification('⚠️ Reporte no encontrado'); return; }
    if (!window.XLSX) { showNotification('⚠️ Librería Excel no disponible'); return; }

    const AREA_LABELS = { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' };

    // ── Cabecera ─────────────────────────────────────────────────
    const headerRow = ['ID', 'Nombre', 'Unidad', 'Grupo', 'CapacidadML', 'PesoBotellaOz'];
    AREA_KEYS.forEach(area => {
        const label = AREA_LABELS[area] || area;
        headerRow.push(`${label} Enteras`, `${label} Abiertas (oz)`, `${label} Total`);
    });
    headerRow.push('Total General', 'Estado');

    const NUM_COLS = headerRow.length;

    // ── Agrupar productos por grupo ───────────────────────────────
    const groupMap = new Map();
    (reporte.productos || []).forEach(p => {
        const g = (p.grupo || 'General').trim();
        if (!groupMap.has(g)) groupMap.set(g, []);
        groupMap.get(g).push(p);
    });
    const sortedGroups = [...groupMap.keys()].sort((a, b) => a.localeCompare(b, 'es'));

    // ── Construir filas ───────────────────────────────────────────
    const rows      = [headerRow];
    let   granTotal = 0;

    sortedGroups.forEach(groupName => {
        const products = groupMap.get(groupName);
        let subtotal   = 0;

        products.forEach(p => {
            const row = [
                p.id,
                p.nombre,
                p.unidad     || '',
                p.grupo      || 'General',
                p.capacidadMl   != null ? p.capacidadMl   : '',
                p.pesoBotellaOz != null ? p.pesoBotellaOz : '',
            ];

            AREA_KEYS.forEach(area => {
                const d = (p.areas || {})[area] || { enteras: 0, totalOzAbiertas: 0, abiertas: 0, total: 0 };
                // Compatibilidad: puede venir totalOzAbiertas (v2) o abiertas count (v1)
                const oz = d.totalOzAbiertas != null ? d.totalOzAbiertas : d.abiertas || 0;
                row.push(d.enteras || 0, oz, d.total || 0);
            });

            const tg    = p.totalGeneral || 0;
            const estado = p.estado || (
                (p.capacidadMl && p.pesoBotellaOz)
                    ? 'Conversión realizada'
                    : 'Falta capacidadMl o pesoBotellaLlenaOz'
            );

            row.push(tg, estado);
            rows.push(row);
            subtotal  += tg;
            granTotal += tg;
        });

        // ── Subtotal por grupo ────────────────────────────────────
        const subtotalRow = new Array(NUM_COLS).fill('');
        subtotalRow[1] = `SUBTOTAL — ${groupName}`;
        subtotalRow[NUM_COLS - 2] = Math.round(subtotal * 100) / 100;
        rows.push(subtotalRow);
    });

    // ── Gran Total ────────────────────────────────────────────────
    const granTotalRow = new Array(NUM_COLS).fill('');
    granTotalRow[1] = 'GRAN TOTAL';
    granTotalRow[NUM_COLS - 2] = Math.round(granTotal * 100) / 100;
    rows.push(granTotalRow);

    // ── Hoja ─────────────────────────────────────────────────────
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 10 }, { wch: 32 }, { wch: 10 }, { wch: 16 },
        { wch: 12 }, { wch: 14 },
        ...AREA_KEYS.flatMap(() => [{ wch: 14 }, { wch: 16 }, { wch: 12 }]),
        { wch: 14 }, { wch: 34 },
    ];

    const sheetName = (reporte.titulo || 'Auditoría').slice(0, 31).replace(/[:\\/?*[\]]/g, '');
    const wb        = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Auditoría');

    const fecha    = (reporte.fecha || new Date().toLocaleDateString('es-MX')).replace(/\//g, '-');
    const filename = `REPORTE_${(reporte.titulo || 'inventario').replace(/\s+/g, '_')}_${fecha}.xlsx`;
    window.XLSX.writeFile(wb, filename);
    showNotification('✅ Reporte descargado');
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
        return `<div class="bg-white rounded-xl p-6 shadow-md text-center">
            <p style="font-size:0.8rem;color:var(--txt-muted);">Sin reportes publicados</p>
        </div>`;
    }

    const AREA_LABELS = { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' };

    let html = '<div class="space-y-2">';
    reportes.forEach((r, idx) => {
        const delay = Math.min(idx * 40, 300);
        html += `<div class="bg-white rounded-xl p-4 shadow-md"
            style="animation:cardIn 0.2s ease-out ${delay}ms both;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.83rem;color:var(--txt-primary);">
                        📊 ${escapeHtml(r.titulo)}
                    </div>
                    <div style="font-size:0.7rem;color:var(--txt-muted);margin-top:3px;">
                        ${escapeHtml(r.fecha)} · ${r.totalProductos || 0} productos
                        · Por ${escapeHtml(r.publicadoPor || '—')}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                        ${AREA_KEYS.map(a => {
                            const st = (r.auditoriaStatus || {})[a];
                            return st === 'completada'
                                ? `<span style="font-size:0.60rem;font-weight:700;padding:1px 7px;border-radius:3px;background:var(--green-dim);color:var(--green-text);border:1px solid rgba(34,197,94,.20);">✓ ${AREA_LABELS[a]}</span>`
                                : `<span style="font-size:0.60rem;padding:1px 7px;border-radius:3px;background:rgba(148,163,184,.10);color:var(--txt-muted);">${AREA_LABELS[a]}</span>`;
                        }).join('')}
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
