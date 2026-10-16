/** A chrome button that never takes focus from the editor. */
export function chromeButton(
  testid: string,
  text: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.tabIndex = -1
  b.dataset.testid = testid
  b.textContent = text
  b.title = title
  // tabIndex -1 does not stop a mouse click from focusing the button in Chromium;
  // cancelling mousedown keeps focus in the editor while click still fires.
  b.addEventListener('mousedown', (e) => {
    if (e.button === 0) e.preventDefault()
  })
  b.addEventListener('click', onClick)
  return b
}
