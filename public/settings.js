// ===== SETTINGS =====

async function loadSettings() {
    const form = document.getElementById('settings-form');
    const status = document.getElementById('settings-status');
    if (!form) return;

    status.textContent = '';
    status.classList.remove('success-msg');
    status.classList.add('error-msg');
    status.classList.add('hidden');

    try {
        const res = await apiFetch(`${API}/api/settings`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const settings = await res.json();
        const mode = settings.result_post_mode || 'both';
        const input = document.querySelector(`input[name="result-post-mode"][value="${mode}"]`);
        if (input) input.checked = true;

        const reasonDmCheckbox = document.getElementById('settings-reason-request-dm-enabled');
        const slowModeCheckbox = document.getElementById('settings-description-slow-mode-enabled');
        const slowModeTime = document.getElementById('settings-description-slow-mode-time');

        if (reasonDmCheckbox) reasonDmCheckbox.checked = settings.reason_request_dm_enabled !== false;
        if (slowModeCheckbox) slowModeCheckbox.checked = settings.description_slow_mode_enabled === true;
        if (slowModeTime) slowModeTime.value = settings.description_slow_mode_time || '04:00';
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            status.textContent = 'Fehler beim Laden der Einstellungen: ' + err.message;
            status.classList.remove('hidden');
        }
    }
}

async function saveSettings(event) {
    event.preventDefault();
    const status = document.getElementById('settings-status');
    const selected = document.querySelector('input[name="result-post-mode"]:checked');
    const resultPostMode = selected?.value || 'both';
    const reasonRequestDmEnabled = document.getElementById('settings-reason-request-dm-enabled')?.checked ?? true;
    const descriptionSlowModeEnabled = document.getElementById('settings-description-slow-mode-enabled')?.checked ?? false;
    const descriptionSlowModeTime = document.getElementById('settings-description-slow-mode-time')?.value || '04:00';

    status.textContent = '';
    status.classList.add('hidden');

    try {
        const res = await apiFetch(`${API}/api/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                result_post_mode: resultPostMode,
                reason_request_dm_enabled: reasonRequestDmEnabled,
                description_slow_mode_enabled: descriptionSlowModeEnabled,
                description_slow_mode_time: descriptionSlowModeTime,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Unbekannter Fehler');
        }
        status.textContent = 'Einstellungen gespeichert.';
        status.classList.remove('error-msg');
        status.classList.add('success-msg');
        status.classList.remove('hidden');
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            status.textContent = 'Fehler beim Speichern: ' + err.message;
            status.classList.remove('success-msg');
            status.classList.add('error-msg');
            status.classList.remove('hidden');
        }
    }
}
