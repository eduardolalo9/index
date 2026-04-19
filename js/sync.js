/**
 * js/sync-patch.js — Patch para sync.js v2.1
 * ══════════════════════════════════════════════════════════════
 * Este archivo aplica un monkey-patch mínimo a la función
 * _subscribeConteoPorUsuario para que también procese los
 * bloqueos de usuario (_userLocks) que vienen en el snapshot.
 *
 * USO: importar en app.js DESPUÉS de que sync.js arranque.
 *
 * NOTA: Este enfoque evita modificar el sync.js de 1100+ líneas
 * y reduce el riesgo de romper la sincronización existente.
 * En un refactor futuro, integrar directamente en sync.js.
 * ══════════════════════════════════════════════════════════════
 */

import { state }                    from './state.js';
import { AREA_KEYS }                from './constants.js';
import { applyUserLocksFromSnapshot } from './audit.js';
import { saveToLocalStorage }       from './storage.js';

/**
 * Se engancha en el listener existente de conteoPorUsuario
 * para procesar los _userLocks cuando llegan de Firestore.
 *
 * Firestore tarda ~1s en propagar, así que hacemos polling
 * ligero con onSnapshot sobre la misma colección pero filtrando
 * solo el campo _userLocks para no interferir con el listener
 * principal de conteo.
 *
 * Llamar DESPUÉS de startRealtimeListeners().
 */
export function initUserLocksListener() {
    if (!window._db || !window.FIRESTORE_DOC_ID) {
        // Reintentar cuando Firebase esté disponible
        setTimeout(initUserLocksListener, 2000);
        return;
    }

    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario');

    AREA_KEYS.forEach(area => {
        baseRef.doc(area).onSnapshot(snap => {
            if (!snap.exists) return;
            const data = snap.data();
            if (!data) return;

            // Solo procesar si hay _userLocks
            if (data._userLocks && typeof data._userLocks === 'object') {
                applyUserLocksFromSnapshot(area, data);
                saveToLocalStorage();
                import('./render.js').then(m => m.renderTab()).catch(() => {});
            }
        }, err => {
            console.warn('[SyncPatch] Error en listener userLocks:', err?.message);
        });
    });

    console.info('[SyncPatch] ✓ Listener de bloqueos de usuario activo.');
}
