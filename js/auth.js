/**
 * js/auth.js — v3.0 DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 * Autenticación Firebase Email/Password con control de roles.
 *
 * FIX BUG-1 (CRÍTICO — app nunca arrancaba):
 * ──────────────────────────────────────────────────────────────
 * PROBLEMA:
 *   _handleLogin() recreaba _authReady = new Promise() EN CADA
 *   llamada, incluyendo el PRIMER login.
 *
 *   Secuencia rota:
 *     1. Módulo carga → P1 creada
 *     2. DOMContentLoaded → app.js: onAuthReady.then(cb) → cb en P1
 *     3. Firebase dispara onAuthStateChanged (async, DESPUÉS del sync)
 *     4. _handleLogin() → _authReady = P2  ← P1 queda huérfana
 *     5. _authResolve(user) → resuelve P2
 *     6. cb de app.js (registrado en P1) NUNCA dispara
 *     → app se queda en "Verificando sesión…" para siempre
 *
 *   La condición `if (_lastAuthUid && _lastAuthUid !== user.uid)`
 *   es FALSE en el primer login (porque _lastAuthUid era null),
 *   así que cleanupRoles() no se llamaba, PERO la recreación de
 *   _authReady en la línea siguiente SÍ ejecutaba siempre.
 *
 * CORRECCIÓN:
 *   Solo recrear _authReady cuando hay CAMBIO DE USUARIO
 *   (es decir, cuando _lastAuthUid ya tenía un valor diferente).
 *   En el PRIMER LOGIN (_lastAuthUid era null), no recrear P1.
 *   app.js ya tiene .then() sobre P1 → recibirá el resolve.
 *
 * Resto de correcciones (v2.2):
 * • Guard _authChangeInProgress evita eventos dobles de Firebase
 * • Timeout de 15s en initRoles como seguridad
 * • Guard contra cambio de usuario durante initRoles en progreso
 * ══════════════════════════════════════════════════════════════
 */

import { initRoles, cleanupRoles } from './auth-roles.js';

const $id = id => document.getElementById(id);

// ── Promise inicial — app.js hace .then() sobre esta ─────────
// CRÍTICO: No recrear esta Promise en el primer login.
let _authResolve;
let _authReady = new Promise(resolve => { _authResolve = resolve; });

export function getAuthReady() { return _authReady; }
export { _authReady as onAuthReady };

const INIT_TIMEOUT = 15000;

let _authChangeInProgress = false;
let _lastAuthUid = null;

// ─── Pantallas ─────────────────────────────────────────────────

function showLogin() {
    $id('authLoadingScreen')?.classList.add('auth-hidden');
    $id('loginScreen')?.classList.remove('auth-hidden');
    $id('appWrapper')?.classList.remove('auth-visible');
    console.info('[Auth] Mostrando pantalla de login.');
}

function showApp(user) {
    $id('authLoadingScreen')?.classList.add('auth-hidden');
    $id('loginScreen')?.classList.add('auth-hidden');
    $id('appWrapper')?.classList.add('auth-visible');
    console.info('[Auth] ✓ Usuario autenticado:', user?.email || 'N/A');
}

function showAuthLoading() {
    $id('authLoadingScreen')?.classList.remove('auth-hidden');
    $id('loginScreen')?.classList.add('auth-hidden');
    $id('appWrapper')?.classList.remove('auth-visible');
}

function showAuthError(message) {
    $id('authLoadingScreen')?.classList.add('auth-hidden');
    $id('loginScreen')?.classList.remove('auth-hidden');
    $id('appWrapper')?.classList.remove('auth-visible');
    const errEl = $id('loginError');
    if (errEl) { errEl.textContent = message; errEl.classList.add('visible'); }
    console.error('[Auth]', message);
}

// ═════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═════════════════════════════════════════════════════════════

export function initAuth() {
    if (!window._auth) {
        console.error('[Auth] Firebase Auth no disponible.');
        showAuthError('⚠️ Error de configuración: Firebase Auth no está disponible.');
        _authResolve(null);
        return;
    }

    window._auth.onAuthStateChanged(async function (user) {
        if (_authChangeInProgress) {
            await new Promise(r => {
                const check = setInterval(() => {
                    if (!_authChangeInProgress) { clearInterval(check); r(); }
                }, 100);
                setTimeout(() => { clearInterval(check); r(); }, 10000);
            });
        }

        _authChangeInProgress = true;
        try {
            if (user) { await _handleLogin(user); }
            else       { _handleLogout(); }
        } catch (err) {
            console.error('[Auth] Error en onAuthStateChanged:', err);
            showLogin();
            _authResolve(null);
        } finally {
            _authChangeInProgress = false;
        }
    });
}

// ─── Handler de LOGIN ──────────────────────────────────────────

async function _handleLogin(user) {
    if (_lastAuthUid === user.uid) {
        console.debug('[Auth] Mismo usuario, ignorando re-trigger.');
        return;
    }

    // Cambio de usuario: limpiar sesión anterior Y recrear Promise
    if (_lastAuthUid !== null && _lastAuthUid !== user.uid) {
        console.info('[Auth] Cambio de usuario — limpiando sesión anterior.');
        cleanupRoles();
        // FIX BUG-1: Solo recrear _authReady cuando hay CAMBIO DE USUARIO.
        // En el PRIMER login (_lastAuthUid era null) NO se recrea,
        // porque app.js ya tiene .then() sobre la Promise original (P1).
        // Recrearla aquí rompía la cadena: app.js nunca arrancaba.
        _authReady = new Promise(resolve => { _authResolve = resolve; });
    }
    // Si _lastAuthUid === null → primer login → NO recrear → P1 sigue válida

    _lastAuthUid = user.uid;
    showAuthLoading();

    try {
        const role = await Promise.race([
            initRoles(user),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), INIT_TIMEOUT)
            )
        ]);

        if (_lastAuthUid !== user.uid) {
            console.warn('[Auth] Usuario cambió durante initRoles — abortando.');
            return;
        }

        console.info(`[Auth] Rol confirmado: ${role}`);
        showApp(user);
        _authResolve(user);

    } catch (err) {
        if (_lastAuthUid !== user.uid) {
            console.warn('[Auth] Usuario cambió durante initRoles (error path).');
            return;
        }
        if (err.message === 'TIMEOUT') {
            console.error('[Auth] Timeout en initRoles — app con rol por defecto.');
        } else {
            console.error('[Auth] Error en initRoles:', err);
        }
        showApp(user);
        _authResolve(user);
    }
}

// ─── Handler de LOGOUT ─────────────────────────────────────────

function _handleLogout() {
    const prevUid = _lastAuthUid;
    _lastAuthUid = null;

    cleanupRoles();
    showLogin();

    // Recrear Promise para el próximo login
    _authReady = new Promise(resolve => { _authResolve = resolve; });
    _authResolve(null);

    if (prevUid) console.info('[Auth] Sesión cerrada.');
}

// ═════════════════════════════════════════════════════════════
// FORMULARIO DE LOGIN
// ═════════════════════════════════════════════════════════════

const AUTH_ERROR_MESSAGES = {
    'auth/user-not-found':         'No existe una cuenta con ese correo.',
    'auth/wrong-password':         'Contraseña incorrecta. Inténtalo de nuevo.',
    'auth/invalid-email':          'El formato del correo no es válido.',
    'auth/too-many-requests':      'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
    'auth/invalid-credential':     'Correo o contraseña incorrectos.',
    'auth/user-disabled':          'Esta cuenta ha sido deshabilitada.',
    'auth/operation-not-allowed':  'Inicio de sesión con correo no habilitado.',
};

export async function handleLogin() {
    if (!window._auth) { window.showNotification?.('⚠️ Firebase no está configurado.'); return; }

    const emailInput = $id('loginEmail');
    const passInput  = $id('loginPassword');
    const errEl      = $id('loginError');
    const btn        = $id('loginBtn');
    const btnText    = $id('loginBtnText');

    const email    = (emailInput?.value || '').trim();
    const password = passInput?.value || '';

    if (errEl) errEl.classList.remove('visible');

    if (!email || !password) {
        if (errEl) { errEl.textContent = 'Por favor ingresa tu correo y contraseña.'; errEl.classList.add('visible'); }
        return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Iniciando sesión…';

    let spinner = null;
    if (btn) { spinner = document.createElement('span'); spinner.className = 'login-spinner'; btn.appendChild(spinner); }

    try {
        await window._auth.signInWithEmailAndPassword(email, password);
        if (passInput) passInput.value = '';
    } catch (err) {
        console.warn('[Auth] Error al iniciar sesión:', err.code);
        if (errEl) {
            errEl.textContent = AUTH_ERROR_MESSAGES[err.code] || `Error: ${err.message || err.code}`;
            errEl.classList.add('visible');
        }
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Iniciar sesión';
        if (spinner) spinner.remove();
    }
}

// ═════════════════════════════════════════════════════════════
// CERRAR SESIÓN
// ═════════════════════════════════════════════════════════════

export async function signOutUser() {
    if (!window._auth) return;
    try {
        window.sbClose?.();
        await window._auth.signOut();
        window.showNotification?.('👋 Sesión cerrada correctamente.');
        console.info('[Auth] signOut ejecutado.');
    } catch (err) {
        console.error('[Auth] Error al cerrar sesión:', err);
        window.showNotification?.('❌ Error al cerrar sesión.');
    }
}

window.handleLogin = handleLogin;
window.signOutUser = signOutUser;

