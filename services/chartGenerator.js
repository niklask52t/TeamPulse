const { createCanvas } = require('@napi-rs/canvas');

/**
 * Generates a bar chart PNG as a Buffer showing poll results.
 */
function generateResultChart(title, date, yes, no, maybe, pending) {
    const W = 600, H = 380;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, W, H);

    // Rounded rect helper
    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // Title
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title.length > 40 ? title.slice(0, 38) + '…' : title, W / 2, 38);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.fillText(date, W / 2, 60);

    const data = [
        { label: 'Ja ✅',      value: yes,     color: '#22c55e', dimColor: '#16532d' },
        { label: 'Nein ❌',    value: no,      color: '#ef4444', dimColor: '#7f1d1d' },
        { label: 'Vielleicht', value: maybe,   color: '#f59e0b', dimColor: '#78350f' },
        { label: 'Offen ⏳',   value: pending, color: '#64748b', dimColor: '#334155' },
    ];

    const total = yes + no + maybe + pending;
    const maxVal = Math.max(...data.map(d => d.value), 1);

    const barW = 96;
    const gap = 24;
    const chartTop = 80;
    const chartBottom = H - 90;
    const chartH = chartBottom - chartTop;
    const startX = (W - (barW * 4 + gap * 3)) / 2;

    data.forEach((d, i) => {
        const x = startX + i * (barW + gap);
        const barH = Math.max((d.value / maxVal) * chartH, d.value > 0 ? 6 : 0);
        const y = chartBottom - barH;

        // Background bar (dim)
        ctx.fillStyle = d.dimColor;
        roundRect(x, chartTop, barW, chartH, 6);
        ctx.fill();

        // Value bar
        if (barH > 0) {
            ctx.fillStyle = d.color;
            roundRect(x, y, barW, barH, 6);
            ctx.fill();
        }

        // Value label on top
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.value, x + barW / 2, y - 10 > chartTop + 4 ? y - 10 : chartTop - 10);

        // Category label below
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        ctx.fillText(d.label, x + barW / 2, chartBottom + 22);
    });

    // Total line
    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Gesamt: ${total} Antworten`, W / 2, H - 20);

    // TeamPulse watermark
    ctx.fillStyle = '#334155';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('TeamPulse', W - 16, H - 8);

    return canvas.toBuffer('image/png');
}

module.exports = { generateResultChart };
