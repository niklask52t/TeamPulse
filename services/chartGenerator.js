const { createCanvas } = require('@napi-rs/canvas');

function formatDate(date) {
    return date && date.includes('-') ? date.split('-').reverse().join('.') : date;
}

function trimTitle(title, max = 48) {
    if (!title || title.length <= max) return title || '';
    return title.slice(0, max - 1).trimEnd() + '…';
}

function drawRoundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function generateResultChart(title, date, yes, no, maybe, pending) {
    const width = 1600;
    const height = 900;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const values = [
        { key: 'yes', label: 'Zusagen', short: 'Ja', value: yes, color: '#22c55e' },
        { key: 'no', label: 'Absagen', short: 'Nein', value: no, color: '#ef4444' },
        { key: 'maybe', label: 'Vielleicht', short: 'Vielleicht', value: maybe, color: '#f59e0b' },
        { key: 'pending', label: 'Offen', short: 'Offen', value: pending, color: '#64748b' },
    ];
    const total = values.reduce((sum, item) => sum + item.value, 0);
    const answered = yes + no + maybe;
    const maxValue = Math.max(...values.map((item) => item.value), 1);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(0.55, '#111827');
    gradient.addColorStop(1, '#1e293b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.beginPath();
    ctx.arc(1360, 110, 210, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(210, 780, 170, 0, Math.PI * 2);
    ctx.fill();

    drawRoundRect(ctx, 56, 56, width - 112, height - 112, 30);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 48px Arial';
    ctx.fillText(trimTitle(title), 96, 132);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 24px Arial';
    ctx.fillText(`Abstimmungsergebnis • ${formatDate(date)}`, 96, 176);

    drawRoundRect(ctx, 92, 216, 320, 168, 24);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.18)';
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 21px Arial';
    ctx.fillText('Antworten gesamt', 124, 266);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 72px Arial';
    ctx.fillText(String(answered), 124, 340);
    ctx.fillStyle = '#64748b';
    ctx.font = '500 24px Arial';
    ctx.fillText(`/ ${total || 0} Mitglieder`, 255, 339);

    const chartX = 540;
    const chartY = 250;
    const chartW = 930;
    const chartH = 420;
    const barW = 170;
    const gap = 54;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 2;
    for (let step = 0; step <= 4; step++) {
        const y = chartY + chartH - (step / 4) * chartH;
        ctx.beginPath();
        ctx.moveTo(chartX, y);
        ctx.lineTo(chartX + chartW, y);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '500 20px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.round((maxValue * step) / 4)), chartX - 18, y + 7);
    }
    ctx.textAlign = 'left';

    values.forEach((item, index) => {
        const x = chartX + index * (barW + gap) + 26;
        const h = item.value === 0 ? 16 : Math.max((item.value / maxValue) * (chartH - 24), 16);
        const y = chartY + chartH - h;

        drawRoundRect(ctx, x, chartY, barW, chartH, 24);
        ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
        ctx.fill();

        const barGradient = ctx.createLinearGradient(0, y, 0, y + h);
        barGradient.addColorStop(0, item.color);
        barGradient.addColorStop(1, item.color + 'BB');
        drawRoundRect(ctx, x, y, barW, h, 24);
        ctx.fillStyle = barGradient;
        ctx.fill();

        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 42px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(String(item.value), x + barW / 2, y - 18);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '600 24px Arial';
        ctx.fillText(item.short, x + barW / 2, chartY + chartH + 42);

        const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;
        ctx.fillStyle = '#64748b';
        ctx.font = '500 20px Arial';
        ctx.fillText(`${percent}%`, x + barW / 2, chartY + chartH + 76);
        ctx.textAlign = 'left';
    });

    const legendX = 104;
    const legendY = 466;
    values.forEach((item, index) => {
        const y = legendY + index * 78;
        ctx.fillStyle = item.color;
        drawRoundRect(ctx, legendX, y, 18, 18, 6);
        ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 24px Arial';
        ctx.fillText(item.label, legendX + 34, y + 15);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 20px Arial';
        ctx.fillText(`${item.value} ${item.value === 1 ? 'Stimme' : 'Stimmen'}`, legendX + 34, y + 42);
    });

    const donutCx = 280;
    const donutCy = 700;
    const donutRadius = 108;
    const donutWidth = 28;
    let currentAngle = -Math.PI / 2;

    if (total > 0) {
        for (const item of values) {
            const slice = (item.value / total) * Math.PI * 2;
            if (slice <= 0) continue;
            ctx.beginPath();
            ctx.strokeStyle = item.color;
            ctx.lineWidth = donutWidth;
            ctx.lineCap = 'round';
            ctx.arc(donutCx, donutCy, donutRadius, currentAngle, currentAngle + slice);
            ctx.stroke();
            currentAngle += slice;
        }
    } else {
        ctx.beginPath();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = donutWidth;
        ctx.arc(donutCx, donutCy, donutRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${total || 0}`, donutCx, donutCy - 4);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 20px Arial';
    ctx.fillText('Mitglieder', donutCx, donutCy + 30);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#64748b';
    ctx.font = '500 22px Arial';
    ctx.fillText('Erstellt mit TeamPulse', width - 310, height - 74);

    return canvas.toBuffer('image/png');
}

module.exports = { generateResultChart };
