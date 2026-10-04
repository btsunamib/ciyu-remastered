export const pronunciationURL = (text, settings = {}) => {
  const encoded = encodeURIComponent(String(text).trim());
  const accent = settings.accent === 'us' ? 2 : 1;
  if (settings.audioTemplate?.startsWith('https://') && settings.audioTemplate.includes('{text}')) {
    return settings.audioTemplate.replaceAll('{text}', encoded).replaceAll('{accent}', String(accent));
  }
  return `https://dict.youdao.com/dictvoice?audio=${encoded}&type=${accent}`;
};
export class Pronunciation {
  constructor(getSettings, onStatus) {
    this.getSettings = getSettings; this.onStatus = onStatus; this.audio = new Audio(); this.token = 0; this.timer = null; this.preloads = [];
    this.audio.preload = 'auto';
  }
  stop() {
    this.token++; clearTimeout(this.timer); this.audio.pause();
    this.audio.onended = null; this.audio.onerror = null; this.audio.onplaying = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.onStatus?.('');
  }
  async english(text, after) {
    this.stop(); const token = this.token; const settings = this.getSettings();
    this.audio.src = pronunciationURL(text, settings); this.audio.playbackRate = settings.rate || 0.95;
    this.audio.preservesPitch = true; this.onStatus?.('正在加载发音…');
    this.audio.onplaying = () => { if (token !== this.token) return; clearTimeout(this.timer); this.onStatus?.('正在播放 · 点发音按钮可重听'); };
    this.audio.onended = () => { if (token === this.token) { this.onStatus?.(''); after?.(); } };
    const fail = message => { if (token !== this.token) return; clearTimeout(this.timer); this.onStatus?.(message || '发音未能加载，点发音按钮再试一次', true); };
    this.audio.onerror = () => fail();
    this.timer = setTimeout(() => { if (!this.audio.paused) return; fail('发音加载较慢，点发音按钮重试'); }, 12000);
    try { await this.audio.play(); }
    catch (error) { fail(error.name === 'NotAllowedError' ? '点发音按钮，开始播放' : undefined); }
  }
  chinese(text, manual = false) {
    if (!text || !('speechSynthesis' in window) || !manual && !this.getSettings().autoSpeakZh) return;
    const settings = this.getSettings(); const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = 'zh-CN'; utterance.rate = settings.rate || 0.95;
    const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === settings.zhVoiceURI && v.lang.toLowerCase().startsWith('zh'));
    if (voice) utterance.voice = voice;
    // Browser synthesis is intentionally used for Chinese only. English always uses MP3 audio.
    window.speechSynthesis.speak(utterance);
  }
  both(en, zh) {
    if (this.getSettings().autoSpeak) this.english(en, () => this.chinese(zh));
    else { this.stop(); this.chinese(zh); }
  }
  prefetch(texts) {
    this.preloads = texts.slice(0, 2).filter(Boolean).map(text => { const audio = new Audio(); audio.preload = 'auto'; audio.src = pronunciationURL(text, this.getSettings()); return audio; });
  }
}
