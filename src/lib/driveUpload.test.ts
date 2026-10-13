import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const refreshSession = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, auth: { refreshSession: () => refreshSession() } } }))

const { callDriveFunction, UploadHttpError } = await import('./driveUpload')
const httpError = (status: number, error: string) => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error }), { status })) })

describe('callDriveFunction', () => {
  beforeEach(() => {
    invoke.mockReset()
    refreshSession.mockReset()
  })
  it('refreshes an expired sign-in once and retries', async () => {
    invoke.mockResolvedValueOnce(httpError(401, 'invalid session')).mockResolvedValueOnce({ data: { ok: true }, error: null })
    refreshSession.mockResolvedValue({ error: null })
    await expect(callDriveFunction({ action: 'start' })).resolves.toEqual({ ok: true })
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('gives up with the 401 when the refresh does not help', async () => {
    invoke.mockResolvedValue(httpError(401, 'invalid session'))
    refreshSession.mockResolvedValue({ error: null })
    const err = await callDriveFunction({ action: 'start' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadHttpError)
    expect((err as InstanceType<typeof UploadHttpError>).status).toBe(401)
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('does not refresh for other errors', async () => {
    invoke.mockResolvedValue(httpError(409, 'attachment limit reached'))
    await expect(callDriveFunction({ action: 'start' })).rejects.toThrow(/attachment limit/)
    expect(refreshSession).not.toHaveBeenCalled()
  })
})
