/**
 * Plantilla Web Modular — JavaScript global
 * Funciones auxiliares para el frontend
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── Auto-ocultar alertas después de 5 segundos ──
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.4s ease';
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 400);
    }, 5000);
  });

  // ── Confirmación de eliminación en tablas ──
  const deleteForms = document.querySelectorAll('form[data-confirm]');
  deleteForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      const message = form.dataset.confirm || '¿Estás seguro?';
      if (!confirm(message)) {
        e.preventDefault();
      }
    });
  });

  // ── Cerrar alertas manualmente al hacer clic ──
  alerts.forEach(alert => {
    alert.addEventListener('click', () => {
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 400);
    });
    alert.style.cursor = 'pointer';
    alert.title = 'Clic para cerrar';
  });
});
