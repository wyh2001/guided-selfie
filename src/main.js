import './style.css'
import { PhotoCapture } from './services/photoCapture.js'

const app = document.querySelector('#app')
const photoService = new PhotoCapture()

app.innerHTML = `
  <main class="capture">
    <h1>Guided Selfie</h1>
    <section class="preview">
      <div class="video-placeholder">Awaiting camera…</div>
      <video autoplay playsinline hidden></video>
      <img alt="snapshot" hidden />
    </section>
    <section class="actions">
      <button type="button" data-action="capture">Take photo</button>
      <button type="button" data-action="retake" hidden>Retake</button>
      <button type="button" data-action="download" hidden disabled>Download</button>
    </section>
    <p class="status"></p>
  </main>
`

const video = app.querySelector('video')
const photo = app.querySelector('img')
const captureBtn = app.querySelector('[data-action="capture"]')
const retakeBtn = app.querySelector('[data-action="retake"]')
const downloadBtn = app.querySelector('[data-action="download"]')
const status = app.querySelector('.status')
const placeholder = app.querySelector('.video-placeholder')

const defaultPlaceholderText = placeholder.textContent

const setVisible = (element, visible) => {
  if (!element) {
    return
  }
  element.hidden = !visible
}

const State = {
  LOADING: 'loading',
  READY: 'ready',
  CAPTURED: 'captured',
  ERROR: 'error',
}

const stateView = {
  [State.LOADING]: {
    video: false,
    photo: false,
    placeholder: true,
    capture: false,
    retake: false,
    download: false,
    downloadDisabled: true,
    placeholderText: defaultPlaceholderText,
    message: 'Awaiting camera…',
  },
  [State.READY]: {
    video: true,
    photo: false,
    placeholder: false,
    capture: true,
    retake: false,
    download: false,
    downloadDisabled: true,
    placeholderText: defaultPlaceholderText,
    message: 'Look at the camera',
  },
  [State.CAPTURED]: {
    video: false,
    photo: true,
    placeholder: false,
    capture: false,
    retake: true,
    download: true,
    downloadDisabled: false,
    placeholderText: defaultPlaceholderText,
    message: 'Done. Snap again?',
  },
  [State.ERROR]: {
    video: false,
    photo: false,
    placeholder: true,
    capture: false,
    retake: false,
    download: false,
    downloadDisabled: true,
    placeholderText: 'Camera unavailable',
    message: 'Camera unavailable',
  },
}

const setState = (state, overrideMessage) => {
  const view = stateView[state]
  if (!view) {
    return
  }

  setVisible(video, view.video)
  setVisible(photo, view.photo)
  setVisible(placeholder, view.placeholder)
  setVisible(retakeBtn, view.retake)
  setVisible(downloadBtn, view.download)

  captureBtn.disabled = !view.capture
  downloadBtn.disabled = view.downloadDisabled

  placeholder.textContent = view.placeholderText
  status.textContent = overrideMessage ?? view.message
}

setState(State.LOADING, 'Awaiting camera…')

async function setupCamera() {
  try {
    const stream = await photoService.init()
    video.srcObject = stream
    setState(State.READY, 'Look at the camera')
  } catch (error) {
    setState(State.ERROR, `Camera unavailable: ${error.message}`)
  }
}

captureBtn.addEventListener('click', async () => {
  try {
    status.textContent = 'Capturing…'
    const photoURL = await photoService.capture()
    photo.src = photoURL
    setState(State.CAPTURED, 'Done. Snap again?')
  } catch (error) {
    status.textContent = `Capture failed: ${error.message}`
  }
})

retakeBtn.addEventListener('click', () => {
  photoService.clearPhoto()
  photo.removeAttribute('src')
  setState(State.READY, 'Look at the camera')
})

downloadBtn.addEventListener('click', () => {
  try {
    photoService.download(`selfie-${Date.now()}.jpg`)
  } catch (error) {
    status.textContent = error.message
  }
})

window.addEventListener('beforeunload', () => {
  photoService.dispose()
  video.srcObject = null
})

setupCamera()
