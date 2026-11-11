// Public profile fields are explicitly selected: never serialize password hashes.
export function publicUser(user) {
  const { id, name, email, age, createdAt, updatedAt } = user;
  return { id, name, email, age, createdAt, updatedAt };
}
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
export function validateRegistration(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body.email);
  const age = body.age ?? null;
  let error;
  if (!name || name.length > 100) error = 'Name must contain 1–100 characters';
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    error = 'Enter a valid email address';
  else if (
    typeof body.password !== 'string' ||
    body.password.length < 5 ||
    body.password.length > 256
  )
    error = 'Password must contain 5–256 characters';
  else if (age !== null && (!Number.isInteger(age) || age < 0 || age > 150))
    error = 'Age must be a whole number between 0 and 150';
  if (error) throw Object.assign(new Error(error), { status: 400 });
  return { name, email, age };
}
