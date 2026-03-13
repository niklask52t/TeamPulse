const TZ = 'Europe/Berlin';

/**
 * Parse a Berlin-local date + time string into a real UTC Date.
 * Handles HH:MM and HH:MM:SS formats, null/undefined inputs.
 */
function parseBerlinDateTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) return new Date(NaN);
    // Normalize to HH:MM (strip seconds if present)
    const time = timeStr.substring(0, 5);
    const guess = new Date(`${dateStr}T${time}:00.000Z`);
    if (isNaN(guess.getTime())) return new Date(NaN);
    const berlinOfGuess = new Date(guess.toLocaleString('sv-SE', { timeZone: TZ }) + 'Z');
    return new Date(guess.getTime() - (berlinOfGuess.getTime() - guess.getTime()));
}

/**
 * Get today's date string (YYYY-MM-DD) in Europe/Berlin timezone.
 */
function berlinToday() {
    return new Date().toLocaleString('sv-SE', { timeZone: TZ }).split(' ')[0];
}

module.exports = { parseBerlinDateTime, berlinToday, TZ };
