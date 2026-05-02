import { type MiddlewareHandler } from 'hono'
import { jwtVerify, SignJWT } from 'jose'

const JWT_SECRET_STR = process.env['JWT_SECRET']
if (!JWT_SECRET_STR || JWT_SECRET_STR.length < 32) {
  throw new Error('JWT_SECRET env var must be set and at least 32 characters long')
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STR)

export async function signToken(sub: string, role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .sign(JWT_SECRET)
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = header.slice(7)
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    c.set('jwtPayload', payload)
    await next()
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }
}
