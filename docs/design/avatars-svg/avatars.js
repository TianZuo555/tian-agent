/* Self-contained SVG avatars. No runtime dependency or embedded raster image. */
(() => {
  const stateInfo = {
    idle: ['空闲', '待命', '自然眨眼，轻微呼吸。'],
    listening: ['接收输入', '待命', '微微侧身，睁大眼睛认真听。'],
    queued: ['排队', '待命', '半睁眼安静等待，沙漏表示尚未开始。'],
    thinking: ['思考', '处理', '抬眼思考，三个思考点依次出现。'],
    planning: ['规划', '处理', '看向一侧，抬眉整理步骤。'],
    delegating: ['委派', '处理', '左右转身，分支箭头表示交接任务。'],
    reading: ['读取', '执行', '视线逐行移动，查看文件或上下文。'],
    editing: ['修改', '执行', '低头轻点，铅笔表示正在修改。'],
    working: ['工作中', '执行', '有节奏地起伏；太阳光芒缓慢转动。'],
    executing: ['运行工具', '执行', '专注地起伏，终端符号表示工具执行。'],
    verifying: ['验证', '执行', '低头检查后点头，核对结果。'],
    reviewing: ['审阅', '执行', '歪头慢慢扫视，放大镜表示检查改动。'],
    streaming: ['输出回复', '处理', '嘴巴轻轻开合，正在说话。'],
    collecting: ['整理结果', '处理', '低头归拢结果，托盘表示收集产物。'],
    waiting: ['等待确认', '需要你', '歪头提问，等待你的答复或审批。'],
    blocked: ['受阻', '需要你', '收起笑容，锁表示缺少权限或前置条件。'],
    success: ['完成', '结束', '弯眼微笑，轻跳一次后停稳。'],
    error: ['失败', '结束', '失落的小表情，感叹号保持静止。'],
    retrying: ['重试', '恢复', '轻轻调整姿态，回转箭头表示再次尝试。'],
    paused: ['暂停', '待命', '半闭眼停住动作，保留继续执行的可能。'],
    cancelled: ['取消', '结束', '放松下沉，叉号表示主动终止。'],
    interrupted: ['中断', '恢复', '睁大眼睛，断线符号表示意外停止。'],
    sleeping: ['打盹', '待命', '闭眼缓慢呼吸，睡眠符号轻轻浮动。'],
    connecting: ['连接中', '恢复', '抬头等待，连接符号缓慢变化。'],
    offline: ['离线', '恢复', '闭眼静止，降低整体透明度。'],
  };
  const states = Object.keys(stateInfo);
  const pose = (state) => (state === 'executing' ? 'working' : state);
  const icons = {
    listening: 'M-8 0Q0-8 8 0M-5 4Q0-1 5 4M0 8V9',
    queued: 'M-7-9H7M-7 9H7M-5-9V-5L5 5V9M5-9V-5L-5 5V9',
    planning: 'M-7-7H7M-7 0H4M-7 7H1',
    delegating: 'M-8 0H1M1 0L7-7M1 0L7 7M2-7H7V-2M2 7H7V2',
    reading: 'M0-6Q-5-10-10-7V8Q-5 5 0 8Q5 5 10 8V-7Q5-10 0-6V8',
    editing: 'M-8 8L-6 2 4-8 9-3-1 7-8 8M2-6L7-1',
    working: 'M-8 5V-1M0 8V-8M8 5V-3',
    executing: 'M-8-6L-2 0-8 6M2 6H9',
    verifying: 'M-8 0L-2 6 8-6M-9 10H9',
    reviewing: 'M4 4L10 10M6-2A8 8 0 1 0-10-2A8 8 0 1 0 6-2',
    streaming: 'M-9-7H9V5H0L-5 10V5H-9Z',
    collecting: 'M-10 1L-7 8H7L10 1H4L2 4H-2L-4 1ZM0-10V-2M-4-6L0-2 4-6',
    blocked: 'M-8-1H8V10H-8ZM-5-1V-6A5 5 0 0 1 5-6V-1',
    retrying: 'M8-4A9 9 0 1 0 8 5M8-10V-4H2',
    paused: 'M-4-8V8M4-8V8',
    cancelled: 'M-7-7L7 7M7-7L-7 7',
    interrupted: 'M-9-6L-3 0-9 6M9-6L3 0 9 6M-2-8L2 8',
    connecting:
      'M-2-6L1-9A5 5 0 0 1 9-1L6 2M2 6L-1 9A5 5 0 0 1-9 1L-6-2M-4 4L4-4',
  };
  const badge = (state) =>
    icons[state]
      ? '<circle class="state-badge" r="17"/><path class="badge-icon" d="' +
        icons[state] +
        '"/>'
      : '';
  const kinds = ['sun', 'earth', 'saturn', 'neptune'];
  const accessories = ['none', 'glasses', 'beret', 'star'];
  const defaults = {
    sun: '#F4BC50',
    earth: '#76C4B1',
    saturn: '#E9AD8D',
    neptune: '#A49AD8',
  };
  function inkFor(color) {
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const background = luminance(color);
    const contrast = (ink) => {
      const foreground = luminance(ink);
      return (
        (Math.max(background, foreground) + 0.05) /
        (Math.min(background, foreground) + 0.05)
      );
    };
    return contrast('#403447') >= contrast('#fff8ed') ? '#403447' : '#fff8ed';
  }
  let sequence = 0;
  const styles = `
.tian-avatar { --ink: #403447; --signal: #81748c; --cheek: #e99186; overflow: visible; }
.tian-avatar * { transform-box: view-box; }
.tian-avatar .texture { fill: color-mix(in srgb, var(--planet-color) 80%, #465254); opacity: .52; }
.tian-avatar .ray { stroke: color-mix(in srgb, var(--planet-color) 88%, #bc733b); stroke-width: 11; stroke-linecap: round; }
.tian-avatar .ring-back, .tian-avatar .ring-front { fill: none; stroke: color-mix(in srgb, var(--planet-color) 46%, #fff5dd); stroke-width: 13; }
.tian-avatar .figure { transition: transform .35s ease; transform-origin: 120px 128px; animation: tian-idle 5s ease-in-out infinite; }
.tian-avatar .rays { transform-origin: 120px 124px; }
.tian-avatar .face { transform-origin: 120px 126px; transition: transform .35s ease; }
.tian-avatar .eye { fill: var(--ink); transform-origin: 120px 119px; transition: transform .3s ease, opacity .2s; }
.tian-avatar .blink { transform-origin: 120px 119px; animation: tian-blink 6s infinite; }
.tian-avatar .line { fill: none; stroke: var(--ink); stroke-width: 4.5; stroke-linecap: round; stroke-linejoin: round; }
.tian-avatar .cheek { fill: var(--cheek); opacity: .24; }
.tian-avatar .closed, .happy-eyes, .mouth-o, .mouth-flat, .mouth-sad, .brows, .sleep-mark, .thought, .wait-mark, .done-mark, .error-mark, .offline-mark { opacity: 0; transition: opacity .25s ease; }
.tian-avatar .mouth-smile { transition: opacity .25s ease; }
.tian-avatar .glasses { fill: none; stroke: var(--ink); stroke-width: 4; }
.tian-avatar .hat { fill: var(--ink); }
.tian-avatar .hat-top { fill: color-mix(in srgb, var(--ink) 86%, #fff); }
.tian-avatar .symbol { fill: none; stroke: var(--signal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.tian-avatar .thought circle { fill: var(--signal); }
.tian-avatar[data-pose='thinking'] .figure { animation: tian-think 3.6s ease-in-out infinite; }
.tian-avatar[data-pose='thinking'] .face { transform: translate(3px, -5px); }
.tian-avatar[data-pose='thinking'] .eye { transform: translate(2px, -2px); }
.tian-avatar[data-pose='thinking'] .mouth-smile,
.tian-avatar[data-pose='waiting'] .mouth-smile,
.tian-avatar[data-pose='sleeping'] .mouth-smile,
.tian-avatar[data-pose='error'] .mouth-smile,
.tian-avatar[data-pose='offline'] .mouth-smile { opacity: 0; }
.tian-avatar[data-pose='thinking'] .mouth-o,
.tian-avatar[data-pose='thinking'] .thought { opacity: 1; }
.tian-avatar[data-pose='thinking'] .thought circle { animation: tian-dot 1.8s ease-in-out infinite; }
.tian-avatar[data-pose='thinking'] .thought circle:nth-child(2) { animation-delay: .2s; }
.tian-avatar[data-pose='thinking'] .thought circle:nth-child(3) { animation-delay: .4s; }
.tian-avatar[data-pose='thinking'] .rays { animation: tian-spin 28s linear infinite; }
.tian-avatar[data-pose='working'] .figure { animation: tian-work 1.4s ease-in-out infinite; }
.tian-avatar[data-pose='working'] .rays { animation: tian-spin 12s linear infinite; }
.tian-avatar[data-pose='working'] .face { transform: translateY(2px); }
.tian-avatar[data-pose='working'] .brows { opacity: 1; }
.tian-avatar[data-pose='working'] .eye { transform: scaleY(.88); }
.tian-avatar[data-pose='waiting'] .figure { animation: none; transform: rotate(-8deg); }
.tian-avatar[data-pose='waiting'] .mouth-o,
.tian-avatar[data-pose='waiting'] .wait-mark { opacity: 1; }
.tian-avatar[data-pose='waiting'] .face { transform: translateY(-2px); }
.tian-avatar[data-pose='sleeping'] .figure { animation: tian-sleep 4s ease-in-out infinite; }
.tian-avatar[data-pose='sleeping'] .eye,
.tian-avatar[data-pose='success'] .eye,
.tian-avatar[data-pose='offline'] .eye { opacity: 0; transform: scaleY(.08); }
.tian-avatar[data-pose='sleeping'] .closed,
.tian-avatar[data-pose='offline'] .closed { opacity: 1; }
.tian-avatar[data-pose='sleeping'] .mouth-o,
.tian-avatar[data-pose='sleeping'] .sleep-mark { opacity: 1; }
.tian-avatar[data-pose='sleeping'] .face { transform: translateY(5px); }
.tian-avatar[data-pose='sleeping'] .rays { transform: rotate(8deg) scale(.96); }
.tian-avatar[data-pose='sleeping'] .sleep-mark { animation: tian-dream 4s ease-in-out infinite; }
.tian-avatar[data-pose='success'] .figure { animation: tian-celebrate .7s ease-out 1; }
.tian-avatar[data-pose='success'] .happy-eyes,
.tian-avatar[data-pose='success'] .done-mark { opacity: 1; }
.tian-avatar[data-pose='success'] .cheek { opacity: .4; }
.tian-avatar[data-pose='error'] .figure { animation: none; transform: translateY(3px); }
.tian-avatar[data-pose='error'] .mouth-sad,
.tian-avatar[data-pose='error'] .error-mark { opacity: 1; }
.tian-avatar[data-pose='error'] .eye { transform: scaleY(.8); }
.tian-avatar[data-pose='offline'] .figure { animation: none; opacity: .5; }
.tian-avatar[data-pose='offline'] .mouth-flat,
.tian-avatar[data-pose='offline'] .offline-mark { opacity: 1; }
.tian-avatar[data-pose='sleeping'] .blink,
.tian-avatar[data-pose='success'] .blink,
.tian-avatar[data-pose='offline'] .blink { animation: none; }
.tian-avatar[data-motion='paused'] * { animation-play-state: paused !important; }
.tian-avatar[data-motion='reduced'] * { animation: none !important; transition: none !important; }
.tian-avatar .state-badge { fill: color-mix(in srgb, var(--planet-color) 24%, #fff9ef); }
.tian-avatar .badge-icon { fill: none; stroke: #403447; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.tian-avatar[data-pose='listening'] .figure { animation: tian-listen 3s ease-in-out infinite; }
.tian-avatar[data-pose='listening'] .eye { transform: scaleY(1.15); }
.tian-avatar[data-pose='queued'] .figure { animation: none; transform: translateY(2px); }
.tian-avatar[data-pose='queued'] .eye { transform: scaleY(.7); }
.tian-avatar[data-pose='planning'] .figure { animation: tian-think 5s ease-in-out infinite; }
.tian-avatar[data-pose='planning'] .face { transform: translate(-4px, -3px); }
.tian-avatar[data-pose='planning'] .brows { opacity: 1; transform: rotate(-6deg); transform-origin: 120px 105px; }
.tian-avatar[data-pose='delegating'] .figure { animation: tian-delegate 2.8s ease-in-out infinite; }
.tian-avatar[data-pose='delegating'] .face { transform: translateX(5px); }
.tian-avatar[data-pose='reading'] .figure { animation: none; }
.tian-avatar[data-pose='reading'] .face { animation: tian-read 3.6s ease-in-out infinite; }
.tian-avatar[data-pose='editing'] .figure { animation: tian-edit 1.8s ease-in-out infinite; }
.tian-avatar[data-pose='editing'] .face { transform: translate(3px, 4px); }
.tian-avatar[data-pose='editing'] .brows { opacity: 1; }
.tian-avatar[data-pose='verifying'] .figure { animation: tian-verify 2.6s ease-in-out infinite; }
.tian-avatar[data-pose='verifying'] .eye { transform: scaleY(.8); }
.tian-avatar[data-pose='verifying'] .face { transform: translateY(3px); }
.tian-avatar[data-pose='reviewing'] .figure { animation: none; transform: rotate(-5deg); }
.tian-avatar[data-pose='reviewing'] .face { animation: tian-read 5.4s ease-in-out infinite; }
.tian-avatar[data-pose='reviewing'] .brows { opacity: 1; }
.tian-avatar[data-pose='streaming'] .figure { animation: tian-idle 2.8s ease-in-out infinite; }
.tian-avatar[data-pose='streaming'] .mouth-smile { opacity: 0; }
.tian-avatar[data-pose='streaming'] .mouth-o { opacity: 1; animation: tian-talk .7s ease-in-out infinite; transform-origin: 121px 145px; }
.tian-avatar[data-pose='collecting'] .figure { animation: tian-verify 3.2s ease-in-out infinite; }
.tian-avatar[data-pose='collecting'] .face { transform: translateY(4px); }
.tian-avatar[data-pose='blocked'] .figure { animation: none; transform: rotate(4deg); }
.tian-avatar[data-pose='blocked'] .mouth-smile { opacity: 0; }
.tian-avatar[data-pose='blocked'] .mouth-flat, .tian-avatar[data-pose='blocked'] .brows { opacity: 1; }
.tian-avatar[data-pose='retrying'] .figure { animation: tian-retry 3s ease-in-out infinite; }
.tian-avatar[data-pose='retrying'] .rays { animation: tian-spin 18s linear infinite reverse; }
.tian-avatar[data-pose='paused'] .figure { animation: none; }
.tian-avatar[data-pose='paused'] .blink { animation: none; }
.tian-avatar[data-pose='paused'] .eye { transform: scaleY(.5); }
.tian-avatar[data-pose='cancelled'] .figure { animation: none; transform: translateY(4px); }
.tian-avatar[data-pose='cancelled'] .mouth-smile { opacity: 0; }
.tian-avatar[data-pose='cancelled'] .mouth-flat { opacity: 1; }
.tian-avatar[data-pose='interrupted'] .figure { animation: none; transform: rotate(4deg); }
.tian-avatar[data-pose='interrupted'] .mouth-smile { opacity: 0; }
.tian-avatar[data-pose='interrupted'] .mouth-o { opacity: 1; }
.tian-avatar[data-pose='interrupted'] .eye { transform: scaleY(1.15); }
.tian-avatar[data-pose='connecting'] .figure { animation: tian-listen 4s ease-in-out infinite; }
.tian-avatar[data-pose='connecting'] .badge-icon { animation: tian-connect 2s ease-in-out infinite; }
@keyframes tian-listen { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(-5deg) scale(1.015); } }
@keyframes tian-delegate { 0%,100% { transform: rotate(-4deg) translateX(-2px); } 50% { transform: rotate(4deg) translateX(2px); } }
@keyframes tian-read { 0%,100% { transform: translate(-4px,2px); } 45% { transform: translate(4px,2px); } 55% { transform: translate(4px,5px); } 90% { transform: translate(-4px,5px); } }
@keyframes tian-edit { 0%,100% { transform: rotate(2deg) translateY(1px); } 30% { transform: rotate(-2deg) translateY(-1px); } 65% { transform: rotate(1deg) translateY(2px); } }
@keyframes tian-verify { 0%,100% { transform: translateY(0); } 35% { transform: translateY(3px) scale(1.01,.99); } 65% { transform: translateY(-1px); } }
@keyframes tian-talk { 0%,100% { transform: scale(1,.6); } 50% { transform: scale(1.3,1.2); } }
@keyframes tian-retry { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
@keyframes tian-connect { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@keyframes tian-idle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@keyframes tian-blink { 0%, 43%, 47%, 100% { transform: scaleY(1); } 45% { transform: scaleY(.08); } }
@keyframes tian-spin { to { transform: rotate(360deg); } }
@keyframes tian-think { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg) translateY(-2px); } }
@keyframes tian-dot { 0%, 70%, 100% { opacity: .3; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-3px); } }
@keyframes tian-work { 0%, 100% { transform: translateY(1px) scale(1.01, .99); } 50% { transform: translateY(-3px) scale(.99, 1.01); } }
@keyframes tian-sleep { 0%, 100% { transform: rotate(-7deg) translateY(3px) scale(1); } 50% { transform: rotate(-7deg) translateY(1px) scale(1.025, .985); } }
@keyframes tian-dream { 0%, 100% { transform: translateY(2px); opacity: .5; } 50% { transform: translateY(-3px); opacity: 1; } }
@keyframes tian-celebrate { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-8px) rotate(-5deg); } 70% { transform: translateY(1px) rotate(3deg); } }
@media (prefers-reduced-motion: reduce) { .tian-avatar * { animation: none !important; transition: none !important; } }
`;
  function render({
    kind = 'sun',
    state = 'idle',
    color = defaults[kind],
    accessory = 'none',
    motion = 'auto',
    name = { sun: 'Chief', earth: 'Atlas', saturn: 'Juno', neptune: 'Vega' }[
      kind
    ],
    label = `${name} · ${stateInfo[state]?.[0] || state}`,
  } = {}) {
    if (
      !kinds.includes(kind) ||
      !states.includes(state) ||
      !accessories.includes(accessory)
    )
      throw new Error('Unknown avatar kind, state, or accessory');
    if (!/^#[0-9a-f]{6}$/i.test(color))
      throw new Error('Avatar colour must be a six-digit hex colour');
    if (!['auto', 'paused', 'reduced'].includes(motion))
      throw new Error('Unknown motion mode');
    const id = `tian-body-${++sequence}`;
    const escape = (text) =>
      String(text).replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;',
          })[c],
      );
    const rays = Array.from(
      { length: 10 },
      (_, i) =>
        `<path class="ray" d="M120 28V40" transform="rotate(${i * 36} 120 124)"/>`,
    ).join('');
    const earth = `<g class="texture"><path d="M79 71C89 62 100 59 111 60L115 74 107 85 111 96 98 102 91 94 78 97 69 86Z"/><path d="M62 119L77 111 88 118 92 133 108 141 102 156 91 163 84 179C68 167 58 147 57 131Z"/><path d="M154 72L165 88 181 98 184 119 174 123 164 112 151 117 142 104 149 94Z"/><path d="M153 155L172 151 174 163 161 176 147 173Z"/></g>`;
    const bands = `<g fill="none" stroke="color-mix(in srgb, var(--planet-color) 74%, #faf4f2)" stroke-width="12" opacity=".8"><path d="M70 85Q118 105 171 85"/><path d="M65 154Q123 179 178 150"/></g>`;
    const glasses = `<g class="glasses"><circle cx="97" cy="120" r="21"/><circle cx="145" cy="120" r="21"/><path d="M118 117Q121 114 124 117M76 115L61 111M166 115L179 111"/></g>`;
    const beret = `<g transform="rotate(16 147 66)"><path class="hat" d="M112 68Q146 52 177 68L174 78Q144 68 115 78Z"/><ellipse class="hat-top" cx="144" cy="61" rx="36" ry="16"/><path d="M148 47Q148 38 155 38" class="line" stroke-width="7"/></g>`;
    const star = `<path d="M167 72L171 81 181 82 173 89 175 99 167 94 158 99 160 89 153 82 163 81Z" fill="color-mix(in srgb, var(--planet-color) 25%, #ffe1a0)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="tian-avatar" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="${escape(label)}" data-kind="${kind}" data-name="${escape(name)}" data-state="${state}" data-pose="${pose(state)}" data-motion="${motion}" style="--planet-color:${color};--ink:${inkFor(color)}">
<title>${escape(label)}</title>
<defs><linearGradient id="${id}" x1="0" y1="0" x2=".65" y2="1"><stop stop-color="color-mix(in srgb, var(--planet-color) 88%, #ffffff)"/><stop offset="1" stop-color="var(--planet-color)"/></linearGradient><clipPath id="${id}-clip"><circle cx="120" cy="124" r="64"/></clipPath></defs>
<style>${styles}</style>
<g class="figure">
${kind === 'sun' ? `<g class="rays">${rays}</g>` : ''}
${kind === 'saturn' ? '<ellipse class="ring-back" cx="120" cy="144" rx="94" ry="27" transform="rotate(-20 120 144)"/>' : ''}
<circle class="body-fill" fill="url(#${id})" cx="120" cy="124" r="64"/>
<g clip-path="url(#${id}-clip)">${kind === 'earth' ? earth : ''}${kind === 'neptune' ? bands : ''}</g>
<g class="face">
<ellipse class="cheek" cx="84" cy="140" rx="10" ry="5"/><ellipse class="cheek" cx="158" cy="140" rx="10" ry="5"/>
<g class="blink"><ellipse class="eye" cx="98" cy="119" rx="6" ry="9"/><ellipse class="eye" cx="144" cy="119" rx="6" ry="9"/></g>
<path class="line closed" d="M90 121Q98 127 106 121M136 121Q144 127 152 121"/>
<path class="line happy-eyes" d="M90 121Q98 109 106 121M136 121Q144 109 152 121"/>
<path class="line brows" d="M91 101L104 104M138 104L151 101"/>
<path class="line mouth-smile" d="M111 141Q121 152 132 141"/>
<ellipse class="line mouth-o" cx="121" cy="145" rx="4" ry="5"/>
<path class="line mouth-flat" d="M114 145H129"/>
<path class="line mouth-sad" d="M112 148Q121 140 131 148"/>
${accessory === 'glasses' ? glasses : ''}
</g>
${kind === 'saturn' ? '<path class="ring-front" d="M26 144A94 27 0 0 0 214 144" transform="rotate(-20 120 144)"/>' : ''}
${accessory === 'beret' ? beret : ''}${accessory === 'star' ? star : ''}
</g>
<g class="activity-badge" transform="translate(199 43)">${badge(state)}</g>
<g class="thought"><circle cx="174" cy="48" r="3"/><circle cx="186" cy="38" r="4"/><circle cx="201" cy="29" r="5"/></g>
<g class="sleep-mark symbol"><path d="M174 68H185L174 79H185M190 45H205L190 60H205"/></g>
<g class="wait-mark symbol"><path d="M192 47C192 36 209 36 209 46C209 53 200 53 200 59M200 66V67"/></g>
<g class="done-mark symbol"><path d="M184 48L193 57 210 37"/></g>
<g class="error-mark symbol"><path d="M200 38V54M200 63V64"/></g>
<g class="offline-mark symbol"><path d="M188 48H208"/></g>
</svg>`;
  }
  function update(
    svg,
    {
      state = svg.dataset.state,
      color = svg.style.getPropertyValue('--planet-color'),
      motion = svg.dataset.motion,
    } = {},
  ) {
    if (
      !states.includes(state) ||
      !/^#[0-9a-f]{6}$/i.test(color) ||
      !['auto', 'paused', 'reduced'].includes(motion)
    )
      throw new Error('Invalid avatar update');
    svg.dataset.state = state;
    svg.dataset.pose = pose(state);
    svg.dataset.motion = motion;
    svg.style.setProperty('--planet-color', color);
    svg.style.setProperty('--ink', inkFor(color));
    const label = svg.dataset.name + ' · ' + stateInfo[state][0];
    svg.setAttribute('aria-label', label);
    svg.querySelector('title').textContent = label;
    svg.querySelector('.activity-badge').innerHTML = badge(state);
  }
  globalThis.TianAvatar = Object.freeze({
    render,
    update,
    states,
    stateInfo,
    kinds,
    accessories,
    defaults,
  });
})();
