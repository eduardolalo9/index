/**
 * js/app.js — v2.3
 *
 * CAMBIOS v2.3:
 *   • Eliminado import de './sync-patch.js' — initUserLocksListener
 *     ahora está integrado directamente en sync.js v3.0.
 *   • La llamada a initUserLocksListener() se importa de sync.js.
 */

import { initTheme } from './ui.js';
import { loadFromLocalStorage, smartAutoSave,
         saveToLocalStorage }          from './storage.js';
import { syncStockByAreaFromConteo, handleFileImport,
         importFullData }              from './products.js';
import { initAuditUser }              from './audit.js';
import { initAuth, onAuthReady }      from './auth.js';
import { switchTab }                  from './render.js';
import { updateNetworkStatus, syncToCloud,
         stopRealtimeListeners,
         initUserLocksListener }       from './sync.js';
import { state }                      from './state.js';
import { INITIAL_PRODUCTS,
         AUTO_SAVE_INTERVAL_MS,
         SYNC_RECOVERY_INTERVAL_MS }   from './constants.js';
import './notificaciones.js';
import './ajustes.js';
import './reportes.js';
import './actions.js';

console.info('[App] BarInventory v2.3 arrancando…');

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.info('[SW] Registrado — scope:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              window.showNotification?.('🔄 Nueva versión disponible — recarga la página');
            }
          });
        });
      })
      .catch(err => console.warn('[SW] Error al registrar:', err));

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SYNC_PENDING' && window._db && navigator.onLine) {
        syncToCloud().catch(e => console.warn('[SW→App] syncToCloud falló:', e));
      }
    });
  });
} else {
  console.info('[SW] Service Workers no soportados.');
}

// ── ESC cierra sidebar ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const anyOpen = ['productModal', 'orderModal', 'inventarioModal']
    .some(id => !document.getElementById(id)?.classList.contains('hidden'));
  if (!anyOpen) window.sbClose?.();
});

// ── Guardar al cerrar pestaña ─────────────────────────────────
window.addEventListener('beforeunload', () => {
  stopRealtimeListeners();
  try { saveToLocalStorage(); } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════
// DOMContentLoaded
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  console.info('[App] DOM listo — iniciando secuencia…');

  initTheme();

  document.getElementById('loginEmail')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('loginPassword')?.focus(); }
  });
  document.getElementById('loginPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window.handleLogin?.(); }
  });

  initAuth();

  onAuthReady.then(user => {
    if (!user) {
      console.info('[App] Sin usuario — esperando login.');
      return;
    }

    console.info('[App] Usuario confirmado — cargando aplicación…');

    initAuditUser();
    loadFromLocalStorage();
    syncStockByAreaFromConteo();

    if (state.products.length === 0) {
      console.info('[App] Primera ejecución — productos de ejemplo.');
      state.products = INITIAL_PRODUCTS;
      saveToLocalStorage();
    }

    switchTab(state.activeTab);

    // Delegación de eventos para inputs de archivo
    document.body.addEventListener('change', function(e) {
      const target = e.target;
      if (!target || target.tagName !== 'INPUT') return;
      if (target.id === 'fileInput')       { handleFileImport(e); return; }
      if (target.id === 'importDataInput') { importFullData(e);   return; }
    });

    // Red online/offline
    window.addEventListener('online',  updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();

    window.addEventListener('online', () => {
      if (state.adjustmentsPending?.length > 0) {
        import('./ajustes.js').then(m => m.subirAjustesPendientes()).catch(() => {});
      }
    });

    // Iniciar listener de bloqueos de usuario
    // Espera 2s para que startRealtimeListeners() haya terminado
    setTimeout(() => {
      initUserLocksListener();
    }, 2000);

    // Auto-guardado cada 30s
    setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS);

    // Sync de recuperación cada 3 min
    setInterval(() => {
      if (navigator.onLine && window._db &&
          state._cloudSyncPending && !state._syncInProgress) {
        syncToCloud().catch(e => console.warn('[App] Sync periódico falló:', e));
      }
    }, SYNC_RECOVERY_INTERVAL_MS);

    // Guard anti doble-click exportToExcel
    let _exportingExcel = false;
    const origExport = window.exportToExcel;
    if (origExport) {
      window.exportToExcel = function(modo) {
        if (_exportingExcel) { window.showNotification?.('⏳ Exportación en proceso…'); return; }
        _exportingExcel = true;
        try { origExport(modo); }
        catch (e) { window.showNotification?.('❌ Error al exportar Excel'); console.error(e); }
        setTimeout(() => { _exportingExcel = false; }, 3000);
      };
    }

    // Label de tema en sidebar
    const sbLabel = document.getElementById('sbThemeLabel');
    if (sbLabel) {
      sbLabel.textContent =
        document.documentElement.getAttribute('data-theme') === 'dark'
          ? 'Modo claro' : 'Modo oscuro';
    }

    console.info('[App] ✓ Arranque completo.');
  });
});
