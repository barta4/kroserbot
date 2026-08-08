const ALLOWED_TRANSITIONS = {
  pendiente: ['confirmado', 'rechazado', 'cancelado'],
  confirmado: ['entregado', 'cancelado'],
  rechazado: [],
  cancelado: [],
  entregado: [],
};

module.exports = {
  isValidTransition(currentStatus, targetStatus) {
    if (!currentStatus) return targetStatus === 'pendiente';
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    return allowed.includes(targetStatus);
  },

  assertTransition(currentStatus, targetStatus) {
    if (!this.isValidTransition(currentStatus, targetStatus)) {
      throw new Error(`Transición de estado inválida: no se puede pasar de '${currentStatus}' a '${targetStatus}'`);
    }
  },
};
