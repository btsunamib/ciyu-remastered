export const PALETTES = {
  iris: { name: '鸢尾', light: ['#5666eb','#f7f8fc','#ffffff','#252b43'], dark: ['#a8b2ff','#171b2a','#232839','#edf0ff'] },
  forest: { name: '林间', light: ['#35715d','#edf3ed','#f9fcf7','#25392c'], dark: ['#88c8a5','#17231e','#22312a','#e1eee4'] },
  sand: { name: '暖沙', light: ['#99652c','#f5eddf','#fff9ef','#463528'], dark: ['#ddba7e','#27211b','#342b23','#f3e8d7'] },
  rose: { name: '玫瑰', light: ['#b64f72','#f9ecf1','#fff6f9','#4a2f3b'], dark: ['#eea2be','#2b1c25','#3a2732','#f8e5ec'] },
  ocean: { name: '海盐', light: ['#23788d','#edf5f6','#f7fcfd','#203d48'], dark: ['#86cddd','#17262d','#21353e','#e0f2f4'] },
  grape: { name: '葡萄', light: ['#8662b0','#f0ecf7','#faf7ff','#392e4b'], dark: ['#c3a7e9','#231e2e','#322a41','#eee6fc'] }
};
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rgb = hex => [1,3,5].map(index => parseInt(hex.slice(index,index+2),16));
const mix = (a,b,t) => `#${rgb(a).map((v,i) => Math.round(v*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('')}`;
const luminance = hex => rgb(hex).reduce((sum,value,i) => { const v=value/255; return sum+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4); },0);
export function applyAppearance(settings, dark) {
  const palette = PALETTES[settings.uiPalette] || PALETTES.iris;
  const colors = settings.uiCustom ? [settings.uiAccent,settings.uiBackground,settings.uiSurface,settings.uiText] : palette[dark?'dark':'light'];
  const [accent,bg,panel,text] = colors;
  const root = document.documentElement;
  root.dataset.layout = settings.uiLayout; root.dataset.density = settings.uiDensity; root.dataset.motion = settings.uiMotion ? 'on' : 'off';
  root.dataset.palette = settings.uiPalette; root.dataset.selection = settings.uiSelection ? 'on' : 'off'; root.style.colorScheme = luminance(bg)<.2?'dark':'light';
  const fonts = { sans: 'Inter,"SF Pro Display",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', serif: 'Georgia,"Noto Serif SC","Songti SC",SimSun,serif', rounded: 'ui-rounded,"SF Pro Rounded","Nunito","PingFang SC","Microsoft YaHei",sans-serif' };
  for (const [key,value] of Object.entries({
    '--primary':accent,'--bg':bg,'--panel':panel,'--text':text,'--muted':mix(text,panel,.43),'--line':mix(text,panel,.87),
    '--soft':mix(bg,panel,.35),'--primary-soft':mix(accent,panel,.91),'--on-primary':luminance(accent)>.45?'#17202b':'#ffffff',
    '--green-soft':mix('#238965',panel,.9),'--red-soft':mix('#cc5964',panel,.92),'--shadow':`0 8px 28px ${mix(text,panel,.1)}09`,
    '--ui-radius':`${settings.uiRadius}px`,'--radius':`${settings.uiRadius}px`,'--font-scale':settings.uiScale/100,'--card-width':`${settings.uiCardWidth}px`,'--ui-font':fonts[settings.uiFont]||fonts.sans
  })) root.style.setProperty(key,value);
  document.querySelector('meta[name="theme-color"]').content=bg;
}
export function appearanceHTML(settings) {
  const select = (key,label,choices) => `<div class="setting-row"><div><h3>${label}</h3></div><select data-setting="${key}" aria-label="${label}">${choices.map(([value,name])=>`<option value="${value}" ${settings[key]===value?'selected':''}>${name}</option>`).join('')}</select></div>`;
  const range = (key,label,min,max,step,unit) => `<div class="appearance-range"><label for="${key}">${label}<output id="${key}-value">${settings[key]}${unit}</output></label><input id="${key}" type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" data-unit="${unit}"></div>`;
  return `<div class="appearance-controls"><div class="field"><label>选一个喜欢的底色</label><div class="palette-grid">${Object.entries(PALETTES).map(([id,p])=>`<button class="palette-choice ${settings.uiPalette===id&&!settings.uiCustom?'selected':''}" data-action="appearance-palette" data-palette="${id}" aria-label="${p.name}配色" aria-pressed="${settings.uiPalette===id&&!settings.uiCustom}"><span style="--swatch-bg:${p.light[1]};--swatch-panel:${p.light[2]};--swatch-accent:${p.light[0]}"><i></i><b></b></span>${p.name}</button>`).join('')}</div></div>
    <div class="setting-row"><div><h3>自由组合颜色</h3><p>背景、卡片、文字和强调色分别选。</p></div><label class="toggle"><input type="checkbox" data-setting="uiCustom" aria-label="自由组合颜色" ${settings.uiCustom?'checked':''}><span></span></label></div>
    <div id="custom-color-fields" class="custom-color-grid" ${settings.uiCustom?'':'hidden'}>${[['uiAccent','强调色'],['uiBackground','页面背景'],['uiSurface','卡片颜色'],['uiText','文字颜色']].map(([key,label])=>`<label><span>${label}</span><input type="color" data-setting="${key}" aria-label="${label}" value="${esc(settings[key])}"><small id="${key}-value">${settings[key]}</small></label>`).join('')}</div>
    <div class="appearance-preview"><div class="preview-dot"></div><div><b>你的词汇小岛</b><p>每一次回忆，都有意义。</p></div><span>继续 →</span></div>
    ${select('uiFont','字体风格',[['sans','简洁现代'],['serif','书页衬线'],['rounded','柔和圆体']])}
    ${range('uiScale','字号比例',85,125,5,'%')}${range('uiRadius','卡片圆角',4,32,2,'px')}${range('uiCardWidth','学习卡片宽度',360,820,20,'px')}
    ${select('uiLayout','电脑 / 平板导航',[['sidebar','左侧导航'],['top','顶部导航']])}${select('uiDensity','页面留白',[['comfortable','舒适'],['compact','紧凑']])}
    <div class="setting-row"><div><h3>界面动画</h3><p>关闭后更安静；始终尊重系统的减少动态设置。</p></div><label class="toggle"><input type="checkbox" data-setting="uiMotion" aria-label="界面动画" ${settings.uiMotion?'checked':''}><span></span></label></div>
    <div class="setting-row"><div><h3>允许长按选择文字</h3><p>默认关闭，避免平板误选。输入框始终可以选中文字。</p></div><label class="toggle"><input type="checkbox" data-setting="uiSelection" aria-label="允许长按选择文字" ${settings.uiSelection?'checked':''}><span></span></label></div>
    <div class="setting-actions"><button class="button" data-action="appearance-reset">恢复默认外观</button><button class="button" data-action="appearance-export">导出外观方案</button><label class="button" for="appearance-file">导入外观方案<input id="appearance-file" type="file" accept=".json,application/json" hidden></label></div><p class="hint" style="margin-top:12px">卡片默认中等宽度、高度随内容增长。外观方案只包含外观设置。</p></div>`;
}
