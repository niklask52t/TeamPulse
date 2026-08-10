// ===== CONTACTS =====

async function loadContacts() {
    const res = await apiFetch(`${API}/api/contacts`);
    const contacts = await res.json();
    const list = document.getElementById('contacts-list');

    if (!contacts.length) {
        list.innerHTML = '<p style="color:var(--text-secondary)">Noch keine Kontakte vorhanden.</p>';
        return;
    }

    // Safe JSON for a single-quoted HTML attribute: JSON.stringify escapes " and \,
    // and we additionally entity-escape & and ' so an attacker-controlled name cannot
    // break out of the onclick attribute (&#39; is decoded back to ' only for the JS engine).
    const attrJson = (value) => JSON.stringify(value ?? '').replace(/&/g, '&amp;').replace(/'/g, '&#39;');

    const rows = contacts.map((contact) => {
        const autoName = contact.name || '-';
        const displayName = contact.display_name || autoName || '-';
        const overrideActive = Boolean(contact.name_override && String(contact.name_override).trim());
        const lid = contact.lid ? String(contact.lid) : '-';

        return `
        <tr>
            <td class="contacts-name-cell">
                <div class="contacts-primary-name">${esc(displayName)}</div>
                ${overrideActive ? '<div class="contacts-override-badge">Override aktiv</div>' : ''}
            </td>
            <td>${esc(autoName)}</td>
            <td>${contact.phone ? esc(contact.phone) : '-'}</td>
            <td class="contacts-lid">${esc(lid)}</td>
            <td class="contacts-actions-cell">
                <button class="btn btn-secondary btn-sm" onclick='editContactOverride(${Number(contact.id)}, ${attrJson(contact.name_override || "")}, ${attrJson(autoName)})'>
                    ${overrideActive ? 'Override ändern' : 'Override setzen'}
                </button>
                ${overrideActive ? `<button class="btn btn-secondary btn-sm" onclick="clearContactOverride(${Number(contact.id)})">Override löschen</button>` : ''}
            </td>
        </tr>`;
    }).join('');

    list.innerHTML = `
        <div class="contacts-summary">
            <span>Gruppenkontakte: <strong>${contacts.length}</strong></span>
            <span>Overrides aktiv: <strong>${contacts.filter((contact) => contact.name_override && String(contact.name_override).trim()).length}</strong></span>
        </div>
        <div class="contacts-table-wrap">
            <table class="contacts-table">
                <thead>
                    <tr>
                        <th>Anzeigename</th>
                        <th>Automatisch</th>
                        <th>Nummer</th>
                        <th>LID</th>
                        <th>Aktionen</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="contacts-help">
            TeamPulse nutzt hier zuerst deinen festen Override. Wenn keiner gesetzt ist, wird weiter der automatisch synchronisierte WhatsApp-Name verwendet.
        </p>`;
}

async function editContactOverride(contactId, currentOverride, autoName) {
    const next = prompt(
        `Anzeigename überschreiben?\n\nLeer lassen = automatischen Namen verwenden\nAutomatisch aktuell: ${autoName || '-'}`,
        currentOverride || ''
    );
    if (next === null) return;
    await saveContactOverride(contactId, next);
}

async function clearContactOverride(contactId) {
    const confirmed = await showConfirmDialog(
        'Override wirklich entfernen? Danach wird wieder der automatisch synchronisierte Name verwendet.',
        {
            title: 'Override entfernen',
            confirmText: 'Entfernen',
            cancelText: 'Abbrechen',
        }
    );
    if (!confirmed) return;
    await saveContactOverride(contactId, '');
}

async function saveContactOverride(contactId, overrideName) {
    try {
        const res = await apiFetch(`${API}/api/contacts/${contactId}/override-name`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ override_name: overrideName }),
        });

        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }

        await refreshContactsRelatedViews();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            alert('Fehler: ' + err.message);
        }
    }
}

async function refreshContactsRelatedViews() {
    await loadContacts();
    if (typeof loadStats === 'function') await loadStats();
    if (typeof loadPolls === 'function') await loadPolls();
    if (typeof loadDashboard === 'function') await loadDashboard();
}
