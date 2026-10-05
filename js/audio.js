// Listen (the phone's Catalan text-to-speech voice) and record myself (microphone).

let voice = null;

function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find(v => v.lang.toLowerCase().replace('_', '-') === 'ca-es')
    || vs.find(v => v.lang.toLowerCase().startsWith('ca')) || null;
  return voice;
}

if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function hasCatalanVoice() {
  return 'speechSynthesis' in window && !!(voice || pickVoice());
}

export function speak(text, rate = 0.9) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ca-ES';
    if (voice || pickVoice()) u.voice = voice;
    u.rate = rate;
    u.onend = u.onerror = res;
    speechSynthesis.speak(u);
  });
}

// Recorder: start() / stop() -> blob URL of my recording.
let rec = null, chunks = [], stream = null;

export const canRecord = () => !!(navigator.mediaDevices && window.MediaRecorder);

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = e => chunks.push(e.data);
  rec.start();
}

export function stopRecording() {
  return new Promise(res => {
    if (!rec) return res(null);
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      rec = null;
      res(url);
    };
    rec.stop();
  });
}

export const isRecording = () => !!rec;

export function play(url) {
  return new Promise(res => {
    const a = new Audio(url);
    a.onended = a.onerror = res;
    a.play().catch(res);
  });
}
