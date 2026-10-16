import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashBytes, noteBytes, writeNote } from '../../../src/main/files'
import { NoteWatcher, type WatcherDeps } from '../../../src/main/watcher'
import type { ExternalChange, NoteFile } from '../../../src/shared/types'

let dir: string
let changes: NoteFile[]
let events: ExternalChange[]
let watcher: NoteWatcher

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await sleep(50)
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdo-watch-'))
  changes = []
  events = []
  watcher = new NoteWatcher((c) => {
    events.push(c)
    if (c.kind === 'changed') changes.push(c.note)
  }, 100)
})
afterEach(() => watcher.close())

describe('NoteWatcher', () => {
  it('reports an external change with the new text', async () => {
    const path = join(dir, 'a.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('alt', false)))
    await sleep(150)
    await writeFile(path, 'neu von außen')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('neu von außen')
  })

  it('ignores its own expected write, also when atomic', async () => {
    const path = join(dir, 'b.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('eigene', false)))
    await writeNote(path, 'eigene', false)
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('keeps working after an atomic replace', async () => {
    const path = join(dir, 'c.md')
    await writeFile(path, '1')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('2', false)))
    await writeNote(path, '2', false)
    await sleep(300)
    await writeFile(path, '3 extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('3 extern')
  })

  it('ignores files that are not watched', async () => {
    const watched = join(dir, 'w.md')
    await writeFile(watched, 'w')
    watcher.setFiles([watched])
    await writeFile(join(dir, 'andere.md'), 'x')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('stops reporting after the file is removed from the set', async () => {
    const path = join(dir, 'd.md')
    await writeFile(path, 'd')
    watcher.setFiles([path])
    watcher.setFiles([])
    await writeFile(path, 'd2')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('seeds a baseline so an unchanged write is not reported without expect()', async () => {
    const path = join(dir, 'e.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    await sleep(150)
    await writeFile(path, 'x')
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'y')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('y')
  })

  it('expect() wins over the seeded baseline', async () => {
    const path = join(dir, 'f.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('neu', false)))
    await sleep(150)
    await writeNote(path, 'neu', false)
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('extern')
  })

  it('re-seeds from disk when a file is re-added after an external change', async () => {
    const path = join(dir, 'g.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.setFiles([])
    await writeFile(path, 'geändert')
    watcher.setFiles([path])
    await sleep(150)
    await writeFile(path, 'geändert')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('ignores a stale read of the old content while our own write is in flight', async () => {
    const path = join(dir, 'h.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('neu', false)))
    // Event for the old content, whose hash is still accepted but no longer latest.
    await writeFile(path, 'x')
    await sleep(600)
    expect(changes).toEqual([])
    await writeNote(path, 'neu', false)
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('extern')
  })

  it('reports an external revert to older content after an own write has settled', async () => {
    const path = join(dir, 'i.md')
    await writeFile(path, 'v1')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('v2', false)))
    await writeNote(path, 'v2', false)
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'v1')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('v1')
  })

  it('reports invalid UTF-8 once per distinct on-disk bytes', async () => {
    const path = join(dir, 'ansi.md')
    await writeFile(path, 'gut')
    watcher.setFiles([path])
    await sleep(150)
    const ansi = Buffer.from('Grüße', 'latin1')
    await writeFile(path, ansi)
    await waitFor(() => events.length > 0)
    await sleep(400)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'unreadable', path, reason: 'encoding' })
    await writeFile(path, ansi)
    await sleep(600)
    expect(events).toHaveLength(1)
    await writeFile(path, Buffer.from('anders ä', 'latin1'))
    await waitFor(() => events.length > 1)
    expect(events[1]).toMatchObject({ kind: 'unreadable', reason: 'encoding' })
  })

  it('does not report our own save over unreadable bytes', async () => {
    const path = join(dir, 'ansi2.md')
    await writeFile(path, 'gut')
    watcher.setFiles([path])
    await sleep(150)
    await writeFile(path, Buffer.from('ä', 'latin1'))
    await waitFor(() => events.length > 0)
    watcher.expect(path, hashBytes(noteBytes('meins', false)))
    await writeNote(path, 'meins', false)
    await sleep(600)
    expect(events).toHaveLength(1)
  })

  it('reports a deletion once and a recreation as a change', async () => {
    const path = join(dir, 'weg.md')
    await writeFile(path, 'da')
    watcher.setFiles([path])
    await sleep(150)
    await rm(path)
    await waitFor(() => events.length > 0)
    await sleep(600)
    expect(events).toEqual([{ kind: 'deleted', path }])
    await writeFile(path, 'wieder da')
    await waitFor(() => events.length > 1)
    expect(events[1]).toMatchObject({ kind: 'changed', note: { text: 'wieder da' } })
  })

  it('reports a recreation with the old content, so a deletion hold is lifted', async () => {
    const path = join(dir, 'weg2.md')
    await writeFile(path, 'gleich')
    watcher.setFiles([path])
    await sleep(150)
    await rm(path)
    await waitFor(() => events.length > 0)
    await writeFile(path, 'gleich')
    await waitFor(() => events.length > 1)
    expect(events[1]).toMatchObject({ kind: 'changed', note: { text: 'gleich' } })
  })

  it('does not report our own recreation after a deletion', async () => {
    const path = join(dir, 'weg3.md')
    await writeFile(path, 'da')
    watcher.setFiles([path])
    await sleep(150)
    await rm(path)
    await waitFor(() => events.length > 0)
    watcher.expect(path, hashBytes(noteBytes('neu', false)))
    await writeNote(path, 'neu', false)
    await sleep(600)
    expect(events).toHaveLength(1)
  })

  it('does not report a delete-and-recreate within the debounce as deleted', async () => {
    const path = join(dir, 'kurz.md')
    await writeFile(path, 'a')
    watcher.setFiles([path])
    await sleep(150)
    await rm(path)
    await sleep(20)
    await writeFile(path, 'b')
    await waitFor(() => events.length > 0)
    await sleep(400)
    expect(events).toEqual([expect.objectContaining({ kind: 'changed' })])
  })

  it('re-checks a missing file once before reporting it deleted', async () => {
    const path = join(dir, 'neu-angelegt.md')
    await writeFile(path, 'a')
    watcher.setFiles([path])
    await sleep(150)
    await rm(path)
    // Past the first check (debounce 100 ms) but inside the confirming re-check.
    await sleep(150)
    await writeFile(path, 'b')
    await waitFor(() => events.length > 0)
    await sleep(400)
    expect(events).toEqual([expect.objectContaining({ kind: 'changed' })])
  })
})

function failingRead(code: string, failures: () => number) {
  let left = 0
  let armed = false
  return {
    arm(): void {
      armed = true
      left = failures()
    },
    read: async (p: string): Promise<Buffer> => {
      if (armed && left > 0) {
        left--
        throw Object.assign(new Error(`${code}: simulated, open '${p}'`), { code })
      }
      return readFile(p)
    },
  }
}

describe('NoteWatcher own content (save base check)', () => {
  it('knows own writes and loads, not the baseline', async () => {
    const path = join(dir, 'o.md')
    await writeFile(path, 'basis')
    watcher.setFiles([path])
    expect(watcher.isOwn(path, hashBytes(noteBytes('basis', false)))).toBe(false)
    watcher.expect(path, hashBytes(noteBytes('meins', false)))
    expect(watcher.isOwn(path, hashBytes(noteBytes('meins', false)))).toBe(true)
  })

  it('forgets own content once an external change was reported', async () => {
    const path = join(dir, 'o2.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    const mine = hashBytes(noteBytes('meins', false))
    watcher.expect(path, mine)
    await writeNote(path, 'meins', false)
    await sleep(300)
    await writeFile(path, 'extern')
    await waitFor(() => changes.length > 0)
    expect(watcher.isOwn(path, mine)).toBe(false)
  })

  it('acknowledge() keeps a state handed over by a refused save from being reported', async () => {
    const path = join(dir, 'ack.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    await sleep(150)
    await writeFile(path, 'extern')
    watcher.acknowledge(path, hashBytes(Buffer.from('extern')))
    await sleep(500)
    expect(events).toEqual([])
    expect(watcher.isOwn(path, hashBytes(Buffer.from('extern')))).toBe(false)
  })

  it('acknowledge(null) records a deletion: no second report, a recreation is reported', async () => {
    const path = join(dir, 'weg.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    await sleep(150)
    await rm(path)
    watcher.acknowledge(path, null)
    await sleep(600)
    expect(events).toEqual([])
    await writeFile(path, 'alt')
    await waitFor(() => events.length > 0)
    expect(events).toEqual([expect.objectContaining({ kind: 'changed' })])
  })
})

describe('NoteWatcher read errors', () => {
  function withRead(read: (p: string) => Promise<Buffer>): void {
    watcher.close()
    watcher = new NoteWatcher(
      (c) => {
        events.push(c)
        if (c.kind === 'changed') changes.push(c.note)
      },
      100,
      read,
    )
  }

  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    're-checks a transient %s instead of reporting it',
    async (code) => {
      const fake = failingRead(code, () => 1)
      withRead(fake.read)
      const path = join(dir, `t-${code}.md`)
      await writeFile(path, 'x')
      watcher.setFiles([path])
      await sleep(150)
      fake.arm()
      await writeFile(path, 'neu')
      await waitFor(() => events.length > 0)
      await sleep(400)
      expect(events).toEqual([expect.objectContaining({ kind: 'changed' })])
    },
  )

  it('re-checks a transient error on unchanged bytes without any event', async () => {
    const fake = failingRead('EBUSY', () => 1)
    withRead(fake.read)
    const path = join(dir, 'same.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    await sleep(150)
    fake.arm()
    await writeFile(path, 'x')
    await sleep(700)
    expect(events).toEqual([])
  })

  it('reports a lasting read error once as unreadable/error, then a recovery as changed', async () => {
    let failing = false
    withRead(async (p) => {
      if (failing)
        throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: 'EACCES' })
      return readFile(p)
    })
    const path = join(dir, 'gesperrt.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    await sleep(150)
    failing = true
    await writeFile(path, 'y')
    await waitFor(() => events.length > 0)
    await writeFile(path, 'z')
    await sleep(600)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'unreadable', path, reason: 'error' })
    expect((events[0] as { message: string }).message).toContain('EACCES')
    failing = false
    await writeFile(path, 'z')
    await waitFor(() => events.length > 1)
    expect(events[1]).toMatchObject({ kind: 'changed', note: { text: 'z' } })
  })
})

describe('NoteWatcher re-arm', () => {
  type Listener = (event: string, name: string) => void
  let attempts: string[]
  let fails: number
  let live: { close: ReturnType<typeof vi.fn>; fire: () => void; listener: Listener }[]
  const reads: string[] = []

  function fakeWatch(failures: number): WatcherDeps['watch'] {
    fails = failures
    return ((d: string, listener: Listener) => {
      attempts.push(d)
      if (fails > 0) {
        fails -= 1
        throw new Error('EACCES')
      }
      const handlers: Record<string, () => void> = {}
      const w = {
        close: vi.fn(),
        on: (ev: string, fn: () => void) => {
          handlers[ev] = fn
          return w
        },
        fire: () => handlers.error?.(),
        listener,
      }
      live.push(w)
      return w
    }) as unknown as WatcherDeps['watch']
  }

  function make(failures: number): NoteWatcher {
    reads.length = 0
    return new NoteWatcher(
      (c) => events.push(c),
      100,
      async (p) => {
        reads.push(p)
        return Buffer.from('x')
      },
      { watch: fakeWatch(failures) },
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    attempts = []
    live = []
  })
  afterEach(() => vi.useRealTimers())

  it('retries a throwing watch() at 1 s and 2 s, then checks every file once', async () => {
    const w = make(2)
    w.setFiles([join(dir, 'a.md'), join(dir, 'b.md')])
    expect(attempts).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(attempts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(attempts).toHaveLength(2)
    vi.advanceTimersByTime(1999)
    expect(attempts).toHaveLength(2)
    expect(reads).toEqual([])
    vi.advanceTimersByTime(1)
    expect(attempts).toHaveLength(3)
    expect(reads).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(reads.sort()).toEqual([join(dir, 'a.md'), join(dir, 'b.md')])
    vi.advanceTimersByTime(60_000)
    expect(attempts).toHaveLength(3)
    w.close()
  })

  it('caps the backoff at 30 s', () => {
    const w = make(100)
    w.setFiles([join(dir, 'a.md')])
    const delays: number[] = []
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      vi.advanceTimersByTime(delay - 1)
      const before = attempts.length
      vi.advanceTimersByTime(1)
      expect(attempts.length).toBe(before + 1)
      delays.push(delay)
    }
    expect(delays.at(-1)).toBe(30000)
    expect(attempts).toHaveLength(8)
    w.close()
  })

  it('re-arms after an error event and re-checks the files', async () => {
    const w = make(0)
    w.setFiles([join(dir, 'a.md')])
    expect(live).toHaveLength(1)
    live[0]?.fire()
    expect(live[0]?.close).toHaveBeenCalled()
    // The folder may be gone: its files are checked at once (deleted folder → held tabs) ...
    await vi.advanceTimersByTimeAsync(100)
    expect(reads).toEqual([join(dir, 'a.md')])
    await vi.advanceTimersByTimeAsync(900)
    expect(live).toHaveLength(2)
    // ... and once more after the re-arm, for changes during the gap.
    await vi.advanceTimersByTimeAsync(100)
    expect(reads).toEqual([join(dir, 'a.md'), join(dir, 'a.md')])
    w.close()
  })

  it('stops retrying for a folder that is no longer needed', () => {
    const w = make(100)
    w.setFiles([join(dir, 'a.md')])
    w.setFiles([])
    vi.advanceTimersByTime(120_000)
    expect(attempts).toHaveLength(1)
    w.close()
  })

  it('close() cancels pending retries', () => {
    const w = make(100)
    w.setFiles([join(dir, 'a.md')])
    w.close()
    vi.advanceTimersByTime(120_000)
    expect(attempts).toHaveLength(1)
  })

  describe('with a fake disk', () => {
    let disk: Map<string, Buffer>
    let got: ExternalChange[]
    const path = () => join(dir, 'n.md')

    function setup(): NoteWatcher {
      disk = new Map([[path(), Buffer.from('alt')]])
      got = []
      return new NoteWatcher(
        (c) => got.push(c),
        100,
        async (p) => {
          const b = disk.get(p)
          if (!b) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
          return b
        },
        { watch: fakeWatch(0) },
      )
    }
    const bytes = (t: string) => Buffer.from(t)

    it('stays silent for our own write during the gap', async () => {
      const w = setup()
      await writeFile(path(), 'alt')
      w.setFiles([path()])
      live[0]?.fire()
      w.expect(path(), hashBytes(bytes('eigen')))
      disk.set(path(), bytes('eigen'))
      await vi.advanceTimersByTimeAsync(1500)
      expect(got).toEqual([])
      w.close()
    })

    it('reports an external change during the gap exactly once', async () => {
      const w = setup()
      await writeFile(path(), 'alt')
      w.setFiles([path()])
      live[0]?.fire()
      disk.set(path(), bytes('extern'))
      await vi.advanceTimersByTimeAsync(1500)
      expect(got).toEqual([
        expect.objectContaining({
          kind: 'changed',
          note: expect.objectContaining({ text: 'extern' }),
        }),
      ])
      live[1]?.fire()
      await vi.advanceTimersByTimeAsync(1500)
      expect(got).toHaveLength(1)
      w.close()
    })

    it('reports a deleted folder as deleted after the confirm, then the restore as one change', async () => {
      const w = setup()
      await writeFile(path(), 'alt')
      w.setFiles([path()])
      live[0]?.fire()
      disk.delete(path())
      await vi.advanceTimersByTimeAsync(1500)
      expect(got).toEqual([{ kind: 'deleted', path: path() }])
      disk.set(path(), bytes('alt'))
      live[1]?.fire()
      await vi.advanceTimersByTimeAsync(1500)
      expect(got).toHaveLength(2)
      expect(got[1]).toMatchObject({ kind: 'changed', note: { text: 'alt' } })
      w.close()
    })

    it('reports a restore with different bytes once', async () => {
      const w = setup()
      await writeFile(path(), 'alt')
      w.setFiles([path()])
      live[0]?.fire()
      disk.delete(path())
      await vi.advanceTimersByTimeAsync(1500)
      disk.set(path(), bytes('anders'))
      live[1]?.fire()
      await vi.advanceTimersByTimeAsync(1500)
      expect(got.map((c) => c.kind)).toEqual(['deleted', 'changed'])
      w.close()
    })

    it('stays silent for our own recreation after the folder came back', async () => {
      const w = setup()
      await writeFile(path(), 'alt')
      w.setFiles([path()])
      live[0]?.fire()
      disk.delete(path())
      await vi.advanceTimersByTimeAsync(1500)
      w.expect(path(), hashBytes(bytes('neu')))
      disk.set(path(), bytes('neu'))
      live[1]?.fire()
      await vi.advanceTimersByTimeAsync(1500)
      expect(got.map((c) => c.kind)).toEqual(['deleted'])
      w.close()
    })

    it('never calls onChange for an in-flight check after close()', async () => {
      disk = new Map()
      got = []
      let release: (b: Buffer) => void = () => {}
      const w = new NoteWatcher(
        (c) => got.push(c),
        100,
        () => new Promise<Buffer>((r) => (release = r)),
        { watch: fakeWatch(0) },
      )
      await writeFile(path(), 'alt')
      w.setFiles([path()])
      live[0]?.listener('change', 'n.md')
      await vi.advanceTimersByTimeAsync(100)
      w.close()
      release(bytes('spaet'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(got).toEqual([])
    })
  })
})

describe('NoteWatcher holds that must lift or appear without file events', () => {
  type Listener = (event: string, name: string) => void
  const file = () => join(dir, 'h.md')
  let disk: Map<string, Buffer>
  let readError: string | null
  let folderGone: boolean
  let watchers: { fire: () => void; listener: Listener }[]
  let got: ExternalChange[]

  const watch = ((_d: string, listener: Listener) => {
    if (folderGone) throw Object.assign(new Error('ENOENT: no such directory'), { code: 'ENOENT' })
    const handlers: Record<string, () => void> = {}
    const w = {
      close: () => undefined,
      on: (ev: string, fn: () => void) => {
        handlers[ev] = fn
        return w
      },
      fire: () => handlers.error?.(),
      listener,
    }
    watchers.push(w)
    return w
  }) as unknown as WatcherDeps['watch']

  function make(): NoteWatcher {
    return new NoteWatcher(
      (c) => got.push(c),
      100,
      async (p) => {
        if (readError) throw Object.assign(new Error(`${readError}: locked`), { code: readError })
        const b = disk.get(p)
        if (!b) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
        return b
      },
      { watch },
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    disk = new Map([[file(), Buffer.from('alt')]])
    readError = null
    folderGone = false
    watchers = []
    got = []
  })
  afterEach(() => vi.useRealTimers())

  it('a deleted folder holds its files although the re-arm keeps failing (ENOENT)', async () => {
    const w = make()
    await writeFile(file(), 'alt')
    w.setFiles([file()])
    disk.delete(file())
    folderGone = true
    watchers[0]?.fire() // the folder watch dies with the folder
    await vi.advanceTimersByTimeAsync(10_000)
    expect(got).toEqual([{ kind: 'deleted', path: file() }])
    w.close()
  })

  it('a folder missing when watching starts reports its files deleted', async () => {
    const w = make()
    await writeFile(file(), 'alt')
    w.expect(file(), hashBytes(Buffer.from('alt'))) // the note was loaded before
    disk.delete(file())
    folderGone = true
    w.setFiles([file()])
    await vi.advanceTimersByTimeAsync(1000)
    expect(got).toEqual([{ kind: 'deleted', path: file() }])
    w.close()
  })

  it('a lasting read error is re-checked with backoff and reported once it reads again', async () => {
    const w = make()
    await writeFile(file(), 'alt')
    w.setFiles([file()])
    readError = 'EBUSY'
    watchers[0]?.listener('change', 'h.md')
    await vi.advanceTimersByTimeAsync(300)
    expect(got.map((c) => c.kind)).toEqual(['unreadable'])
    // The lock outlives the confirm; releasing it produces no file event.
    await vi.advanceTimersByTimeAsync(3000)
    expect(got).toHaveLength(1)
    readError = null
    await vi.advanceTimersByTimeAsync(5000)
    expect(got).toHaveLength(2)
    expect(got[1]).toMatchObject({ kind: 'changed', note: { text: 'alt' } })
    // Settled: no more re-checks, no more events.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(got).toHaveLength(2)
    w.close()
  })

  it('stops re-checking an unreadable file once it is no longer watched or on close', async () => {
    const w = make()
    await writeFile(file(), 'alt')
    w.setFiles([file()])
    readError = 'EACCES'
    watchers[0]?.listener('change', 'h.md')
    await vi.advanceTimersByTimeAsync(300)
    w.setFiles([])
    readError = null
    await vi.advanceTimersByTimeAsync(120_000)
    expect(got.map((c) => c.kind)).toEqual(['unreadable'])
    w.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})
