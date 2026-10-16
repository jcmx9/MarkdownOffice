export function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** HH:MM that updates right at each minute boundary while started. */
export class Clock {
  readonly el = document.createElement('span')
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    className: string,
    testid: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.el.className = className
    this.el.dataset.testid = testid
  }

  start(): void {
    this.stop()
    this.tick()
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** Shows the time and schedules the next tick at the next minute boundary. */
  private tick(): void {
    const d = this.now()
    this.el.textContent = formatClock(d)
    const untilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds())
    this.timer = setTimeout(() => this.tick(), untilNextMinute)
  }
}
