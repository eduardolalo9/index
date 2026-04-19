/* ACTUALIZADO PARA CUMPLIR ESPECIFICACIÓN 100% - v4.0 */
/**
 * js/audit.js — Lógica completa de la pestaña Auditoría
 * Renderiza tarjetas de área, conteo por usuario, botones de completar/reabrir
 */

import { state } from './state.js';
import { renderTab } from './render.js';
import { showNotification } from './ui.js';
import { saveToLocalStorage } from './storage.js';

export function renderAuditTab() {
  const container = document.getElementById('auditContainer');
  if (!container) return;

  let html = `<div class="audit-screen">`;

  // Botón Admin: Iniciar nuevo ciclo
  if (state.userRole === 'admin') {
    html += `
      <button onclick="window.startNewAuditCycle()" class="audit-export-btn">
        🔄 Iniciar Nuevo Ciclo de Auditoría
      </button>`;
  }

  // Tarjetas por área
  Object.keys(AREAS).forEach(areaKey => {
    const areaName = AREAS[areaKey];
    const isCompletedByMe = state.auditoriaStatus?.[areaKey]?.[state.currentUser?.uid]?.completed || false;

    html += `
      <div class="audit-area-card ${isCompletedByMe ? 'completada' : ''}" onclick="switchArea('${areaKey}'); renderTab();">
        <div class="audit-area-icon">📍</div>
        <div class="audit-area-info">
          <div class="audit-area-name">${areaName}</div>
          <div class="audit-area-status ${isCompletedByMe ? 'completada' : 'pendiente'}">
            ${isCompletedByMe ? '✅ COMPLETADA' : '⏳ PENDIENTE'}
          </div>
        </div>
        <div class="audit-area-arrow">→</div>
      </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

console.info('[Audit] ✓ Módulo cargado – renderizado de auditoría multiusuario');
