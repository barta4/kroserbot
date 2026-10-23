function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return res.status(400).json({
        error: issues[0]?.message || 'Datos de solicitud inválidos',
        details: issues,
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
