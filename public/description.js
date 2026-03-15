// ===== GROUP DESCRIPTION BLOCKS =====

let editingBlockId = null;

async function loadDescriptionBlocks() {
    const list = document.getElementById('desc-blocks-list');
    if (!list) return;
    try {
        const res = await apiFetch(`${API}/api/description-blocks`);
        const blocks = await res.json();

        if (!blocks.length) {
            list.innerHTML = '<p style="color:var(--text-secondary)">Keine Textblöcke vorhanden.</p>';
        } else {
            const posLabels = { above: 'Oberhalb', below: 'Unterhalb' };
            list.innerHTML = blocks.map(b => `
                <div class="card">
                    <div class="card-info" style="flex:1">
                        <h3>${esc(b.content.slice(0, 80))}${b.content.length > 80 ? '...' : ''}</h3>
                        <p><span class="badge badge-${b.position === 'above' ? 'active' : 'closed'}">${posLabels[b.position]}</span> Reihenfolge: ${b.sort_order}</p>
                    </div>
                    <div class="card-actions">
                        <button class="btn btn-secondary btn-sm" onclick="editDescBlock(${b.id})">Bearbeiten</button>
                        <button class="btn btn-secondary btn-sm" onclick="deleteDescBlock(${b.id})">Löschen</button>
                    </div>
                </div>
            `).join('');
        }

        loadDescriptionPreview();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            list.innerHTML = '<p style="color:var(--red)">Fehler: ' + esc(err.message) + '</p>';
        }
    }
}

function showDescBlockForm() {
    editingBlockId = null;
    document.getElementById('desc-block-form-title').textContent = 'Neuer Textblock';
    document.getElementById('desc-block-content').value = '';
    document.getElementById('desc-block-position').value = 'above';
    document.getElementById('desc-block-order').value = '0';
    document.getElementById('desc-block-form').classList.remove('hidden');
    attachFormListeners('desc-block-form-el');
}

function hideDescBlockForm() {
    document.getElementById('desc-block-form').classList.add('hidden');
    editingBlockId = null;
    clearDirty();
}

async function editDescBlock(id) {
    try {
        const res = await apiFetch(`${API}/api/description-blocks`);
        const blocks = await res.json();
        const block = blocks.find(b => b.id === id);
        if (!block) return;

        editingBlockId = id;
        document.getElementById('desc-block-form-title').textContent = 'Textblock bearbeiten';
        document.getElementById('desc-block-content').value = block.content;
        document.getElementById('desc-block-position').value = block.position;
        document.getElementById('desc-block-order').value = block.sort_order;
        document.getElementById('desc-block-form').classList.remove('hidden');
        attachFormListeners('desc-block-form-el');
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

async function saveDescBlock(e) {
    e.preventDefault();
    const data = {
        content: document.getElementById('desc-block-content').value,
        position: document.getElementById('desc-block-position').value,
        sort_order: Number(document.getElementById('desc-block-order').value) || 0,
    };

    try {
        const url = editingBlockId
            ? `${API}/api/description-blocks/${editingBlockId}`
            : `${API}/api/description-blocks`;
        const method = editingBlockId ? 'PUT' : 'POST';
        const res = await apiFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        clearDirty();
        hideDescBlockForm();
        loadDescriptionBlocks();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

async function deleteDescBlock(id) {
    if (!confirm('Textblock wirklich löschen?')) return;
    try {
        const res = await apiFetch(`${API}/api/description-blocks/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        loadDescriptionBlocks();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

async function loadDescriptionPreview() {
    const pre = document.getElementById('desc-preview');
    if (!pre) return;
    try {
        const res = await apiFetch(`${API}/api/description-blocks/preview`);
        const data = await res.json();
        pre.textContent = data.description;
        const counter = document.getElementById('desc-char-count');
        if (counter) counter.textContent = `${data.length} / ${data.maxLength} Zeichen`;
    } catch { /* ignore */ }
}

async function triggerDescriptionUpdate() {
    try {
        const res = await apiFetch(`${API}/api/description-blocks/update`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        alert('WhatsApp-Gruppenbeschreibung aktualisiert!');
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}
