// ===== SETTINGS =====

async function loadSettings() {
    const form = document.getElementById('settings-form');
    const status = document.getElementById('settings-status');
    if (!form) return;

    status.textContent = '';
    status.classList.add('hidden');

    try {
        const res = await apiFetch(`${API}/api/settings`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const settings = await res.json();
        const mode = settings.result_post_mode || 'both';
        const input = document.querySelector(`input[name="result-post-mode"][value="${mode}"]`);
        if (input) input.checked = true;
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

    status.textContent = '';
    status.classList.add('hidden');

    try {
        const res = await apiFetch(`${API}/api/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result_post_mode: resultPostMode }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Unbekannter Fehler');
        }
        status.textContent = 'Einstellungen gespeichert.';
        status.classList.remove('hidden');
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            status.textContent = 'Fehler beim Speichern: ' + err.message;
            status.classList.remove('hidden');
        }
    }
}
