/**
 * js/app.js — v2.1 CORREGIDO
 *
 * FIX BUG-5: Service Worker con ruta absoluta '/sw.js' y scope '/'
 *   falla en GitHub Pages porque el site vive en /index/, no en la
 *   raíz del dominio. El navegador rechaza el registro silenciosamente.
 *   Sin SW: sin instalación PWA, sin caché offline.
 *   En una barra sin WiFi estable esto inutiliza la app.
 *
 *   CORRECCIÓN: Rutas relativas './sw.js' con scope './'
 *   funcionan en cualquier subdirectorio de GitHub Pages.
 */

import { initTheme } from './ui.js';
import { loadFromLocalStorage, smartAutoSave,
         saveToLocalStorage }          from './storage.js';
import { syncStockByAreaFromConteo, handleFileImport,
         importFullData }              from './products.js';
import { initAuditUser }              from './audit.js';
import { initAuth, onAuthReady, getAuthReady } from './auth.js';
import { switchTab }                  from './render.js';
import { updateNetworkStatus, syncToCloud,
         stopRealtimeListeners }       from './sync.js';
import { state }                      from './state.js';
import { INITIAL_PRODUCTS,
         AUTO_SAVE_INTERVAL_MS,
         SYNC_RECOVERY_INTERVAL_MS }   from './constants.js';
import './notificaciones.js';
import './ajustes.js';
import './reportes.js';
import './actions.js';

console.info('[App] BarInventory arrancando…');

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // FIX BUG-5: './sw.js' relativo funciona en /index/ de GitHub Pages.
    // La ruta absoluta '/sw.js' buscaba el archivo en la raíz del dominio.
    window.addEventListener('beforeunload', () => {
  stopRealtimeListeners();
  try { saveToLocalStorage(); } catch (_) {}
});
      .then(reg => {
        console.info('[SW] Registrado — scope:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('[SW] Nueva versión disponible.');
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

// ── ESC cierra sidebar (sin interferir con modales abiertos) ──
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

  // Enter en campos del login
  document.getElementById('loginEmail')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('loginPassword')?.focus(); }
  });
  document.getElementById('loginPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window.handleLogin?.(); }
  });

  // Iniciar autenticación
  initAuth();

  // ── Manejador de sesión re-entrante ─────────────────────────
  // FIX BUG-3: onAuthReady es una Promise que solo se resuelve UNA VEZ.
  // Después de logout + re-login, auth.js crea una nueva Promise (P2),
  // pero el .then() registrado aquí está en P1 y no vuelve a disparar.
  // SOLUCIÓN: usamos getAuthReady() en cada ciclo para siempre obtener
  // la Promise actual, y encadenamos un nuevo .then() en cada login.

  let _appInitialized = false; // Solo inicializar listeners globales una vez

  function _waitForUser() {
    getAuthReady().then(user => {
      if (!user) {
        console.info('[App] Sin usuario — esperando login.');
        // Esperar el próximo ciclo de login
        _listenForNextLogin();
        return;
      }

      console.info('[App] Usuario confirmado — cargando aplicación…');

      initAuditUser();
      loadFromLocalStorage();
      syncStockByAreaFromConteo();

      // Solo cargar productos de ejemplo en primera ejecución real
      // FIX BUG-13: verificar también si hay datos en cloud antes de cargar demo
     setInterval(() => {
  if (navigator.onLine && window._db && state.userRole !== null &&
      state._cloudSyncPending && !state._syncInProgress) {
    syncToCloud()
  }
}, SYNC_RECOVERY_INTERVAL_MS);
      switchTab(state.activeTab);

      // Inicializar listeners globales solo una vez por sesión del navegador
      if (!_appInitialized) {
        _appInitialized = true;

        // Delegación de eventos para inputs de archivo
        document.body.addEventListener('change', function(e) {
          const target = e.target;
          if (!target || target.tagName !== 'INPUT') return;
          if (target.id === 'fileInput') { handleFileImport(e); return; }
          if (target.id === 'importDataInput') { importFullData(e); return; }
        });

        // Red online/offline
        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);

        window.addEventListener('online', () => {
          if (state.adjustmentsPending?.length > 0) {
            import('./ajustes.js').then(m => m.subirAjustesPendientes()).catch(() => {});
          }
        });

        // Auto-guardado cada 30s
        setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS);

        // Sync de recuperación cada 3 min
        setInterval(() => {
          if (navigator.onLine && window._db && state.userRole !== null &&
              state._cloudSyncPending && !state._syncInProgress) {
            console.info('[App] Sync de recuperación…');
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
      }

      updateNetworkStatus();
      console.info('[App] ✓ Arranque completo.');

      // Después del logout, volver a escuchar el siguiente login
      _listenForNextLogin();
    }).catch(err => {
      console.error('[App] Error en getAuthReady():', err);
      _listenForNextLogin();
    });
  }

  // Escucha el próximo ciclo de auth (re-login después de logout)
  function _listenForNextLogin() {
    // Verificar cada 300ms si hay una nueva Promise de auth disponible
    // (auth.js la recrea en logout/re-login)
    let _prevPromise = getAuthReady();
    const _checkInterval = setInterval(() => {
      const _current = getAuthReady();
      if (_current !== _prevPromise) {
        clearInterval(_checkInterval);
        _prevPromise = _current;
        _waitForUser();
      }
    }, 300);
  }

  _waitForUser();
});

