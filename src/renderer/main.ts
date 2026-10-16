import './styles.css'
import './theme.css'
import { App } from './app'
import { registerFonts } from './ui/fonts'

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} fehlt in index.html`)
  return el
}

registerFonts(document)

const app = new App({
  tabbar: byId('tabbar'),
  editor: byId('editor'),
  empty: byId('empty'),
  status: byId('status'),
  infoline: byId('infoline'),
  outline: byId('outline'),
  notices: byId('notices'),
})
void app.start()
