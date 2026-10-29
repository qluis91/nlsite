'use strict';

const COSTA_RICA_TIME_ZONE = 'America/Costa_Rica';

function formatDateTimeCR(value) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('es-CR', {
    timeZone: COSTA_RICA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

module.exports = {
  COSTA_RICA_TIME_ZONE,
  formatDateTimeCR,
};
