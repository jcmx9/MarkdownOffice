import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutosaveScheduler } from '../../../src/renderer/editor/autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AutosaveScheduler', () => {
  it('saves once, 1 s after the last touch', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    await vi.advanceTimersByTimeAsync(800)
    a.touch()
    await vi.advanceTimersByTimeAsync(800)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush saves immediately and cancels the pending timer', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    expect(await a.flush()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure until it succeeds', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const a = new AutosaveScheduler(save, 1000, 5000)
    expect(await a.flush()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('treats a throwing save as failure', async () => {
    const a = new AutosaveScheduler(async () => {
      throw new Error('kaputt')
    })
    expect(await a.flush()).toBe(false)
    a.dispose()
  })

  it('never runs saves concurrently', async () => {
    let running = 0
    let maxRunning = 0
    const save = vi.fn(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 100))
      running--
      return true
    })
    const a = new AutosaveScheduler(save)
    const first = a.flush()
    const second = a.flush()
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([first, second])
    expect(save).toHaveBeenCalledTimes(2)
    expect(maxRunning).toBe(1)
  })

  it('dispose stops pending work', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    a.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('dispose during an in-flight failing save schedules no retry', async () => {
    const save = vi.fn(() => new Promise<boolean>((r) => setTimeout(() => r(false), 100)))
    const a = new AutosaveScheduler(save)
    const pending = a.flush()
    await vi.advanceTimersByTimeAsync(50)
    a.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('repeated failures retry every 5 s until success, then stop', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const a = new AutosaveScheduler(save, 1000, 5000)
    expect(await a.flush()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(save).toHaveBeenCalledTimes(4)
  })

  it('overlapping failing flushes keep only one retry loop', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const a = new AutosaveScheduler(save, 1000, 5000)
    const first = a.flush()
    const second = a.flush()
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    await vi.advanceTimersByTimeAsync(20_000)
    // Four calls: two overlapping flushes, then one retry loop (fail, then succeed).
    expect(save).toHaveBeenCalledTimes(4)
  })

  it('a synchronously throwing save resolves false and does not poison later saves', async () => {
    const save = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('sync kaputt')
      })
      .mockResolvedValueOnce(true)
    const a = new AutosaveScheduler(save)
    expect(await a.flush()).toBe(false)
    expect(await a.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    a.dispose()
  })
})
