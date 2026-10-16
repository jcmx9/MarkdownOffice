import { describe, expect, it } from 'vitest'
import { LatestToggle, SerialQueue } from '../../../src/renderer/util/serial'

const tick = () => new Promise((r) => setTimeout(r))

describe('SerialQueue', () => {
  it('runs ops one after another, in order', async () => {
    const q = new SerialQueue()
    const log: string[] = []
    let release = () => {}
    const first = q.run(
      () =>
        new Promise<void>((r) => {
          log.push('a start')
          release = () => {
            log.push('a end')
            r()
          }
        }),
    )
    const second = q.run(async () => {
      log.push('b')
    })
    await tick()
    expect(log).toEqual(['a start'])
    release()
    await Promise.all([first, second])
    expect(log).toEqual(['a start', 'a end', 'b'])
  })

  it('a rejected op does not block later ops', async () => {
    const q = new SerialQueue()
    const failed = q.run(async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')
    let ran = false
    await q.run(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('is busy while an op is queued or running', async () => {
    const q = new SerialQueue()
    expect(q.busy).toBe(false)
    let release = () => {}
    const p = q.run(() => new Promise<void>((r) => (release = r)))
    expect(q.busy).toBe(true)
    await tick()
    release()
    await p
    expect(q.busy).toBe(false)
  })
})

describe('LatestToggle', () => {
  /** A toggle whose apply() only settles when release() is called. */
  function setup(initial = false) {
    let on = initial
    const applied: boolean[] = []
    const releases: Array<() => void> = []
    const t = new LatestToggle(
      () => on,
      (want) => {
        applied.push(want)
        on = want // the mode switches at once; the fullscreen request is what is in flight
        return new Promise<void>((r) => releases.push(r))
      },
    )
    const release = async () => {
      releases.shift()?.()
      await tick()
    }
    return { t, applied, release, state: () => on, setState: (v: boolean) => (on = v) }
  }

  it('toggles once when idle', async () => {
    const s = setup()
    const done = s.t.toggle()
    expect(s.applied).toEqual([true])
    await s.release()
    await done
    expect(s.state()).toBe(true)
  })

  it('remembers a toggle during an in-flight request and applies it once settled', async () => {
    const s = setup()
    const done = s.t.toggle()
    void s.t.toggle() // pressed again during the enter animation
    expect(s.applied).toEqual([true])
    await s.release()
    expect(s.applied).toEqual([true, false])
    await s.release()
    await done
    expect(s.state()).toBe(false)
  })

  it('an even number of extra toggles is a no-op (last intent wins)', async () => {
    const s = setup()
    const done = s.t.toggle()
    void s.t.toggle()
    void s.t.toggle()
    await s.release()
    await done
    expect(s.applied).toEqual([true])
    expect(s.state()).toBe(true)
  })

  it('compares with the state at settle time (e.g. Esc left meanwhile)', async () => {
    const s = setup()
    const done = s.t.toggle()
    void s.t.toggle() // wants false ...
    s.setState(false) // ... and Esc already left Present
    await s.release()
    await done
    expect(s.applied).toEqual([true])
  })

  it('exposes the state a coalesced toggle still wants (null when none)', async () => {
    const s = setup()
    const done = s.t.toggle()
    expect(s.t.pendingWant).toBeNull()
    void s.t.toggle()
    expect(s.t.pendingWant).toBe(false)
    void s.t.toggle()
    expect(s.t.pendingWant).toBe(true)
    await s.release()
    await done
    expect(s.t.pendingWant).toBeNull()
  })

  it('set() applies only a real change when idle', async () => {
    const s = setup(true)
    await s.t.set(true)
    expect(s.applied).toEqual([])
    const done = s.t.set(false)
    expect(s.applied).toEqual([false])
    await s.release()
    await done
    expect(s.state()).toBe(false)
  })

  it('set() during an in-flight request wants that state, however often it is called', async () => {
    const s = setup()
    const done = s.t.toggle() // entering
    void s.t.set(false)
    void s.t.set(false) // a second toggle() would flip back; set() stays false
    expect(s.t.pendingWant).toBe(false)
    await s.release()
    expect(s.applied).toEqual([true, false])
    await s.release()
    await done
    expect(s.state()).toBe(false)
  })

  it('a failing request does not block later toggles', async () => {
    let calls = 0
    const t = new LatestToggle(
      () => false,
      async () => {
        calls++
        throw new Error('boom')
      },
    )
    await expect(t.toggle()).rejects.toThrow('boom')
    await expect(t.toggle()).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })
})
