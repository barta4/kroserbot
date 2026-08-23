function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return { valid: false, errors };
  }
  return { valid: true, data: result.data };
}

module.exports = { validate };
