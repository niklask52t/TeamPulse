const TZ = 'Europe/Berlin';

/**
 * Parse a Berlin-local date + time string into a real UTC Date.
 * event_date (YYYY-MM-DD) and event_time (HH:MM) are entered in Berlin time.
 */
function parseBerlinDateTime(dateStr, timeStr) {
    // Treat the date+time as UTC first, then find the Berlin→UTC offset at that moment.
    const guess = new Date(`${dateStr}T${timeStr}:00.000Z`);
    const berlinOfGuess = new Date(guess.toLocaleString('sv-SE', { timeZone: TZ }) + 'Z');
    return new Date(guess.getTime() - (berlinOfGuess.getTime() - guess.getTime()));
}

module.exports = { parseBerlinDateTime, TZ };
