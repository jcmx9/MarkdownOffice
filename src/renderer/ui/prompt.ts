/** Modal text input. Resolves null on cancel/Esc or empty input. */
export function askText(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'prompt'
    const form = document.createElement('form')
    form.method = 'dialog'
    const heading = document.createElement('h2')
    heading.textContent = title
    const field = document.createElement('label')
    field.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.spellcheck = false
    field.append(input)
    const ok = document.createElement('button')
    ok.type = 'submit'
    ok.value = 'ok'
    ok.textContent = 'OK'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Abbrechen'
    cancel.addEventListener('click', () => dialog.close('cancel'))
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(ok, cancel)
    form.append(heading, field, actions)
    dialog.append(form)
    dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'ok'
      dialog.remove()
      resolve(accepted ? input.value.trim() || null : null)
    })
    document.body.append(dialog)
    dialog.showModal()
    input.select()
  })
}
