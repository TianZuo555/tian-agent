(() => {
  const { render, update, stateInfo, states, defaults } = globalThis.TianAvatar;
  const characters = [
    {
      kind: 'sun',
      name: 'Chief',
      role: 'SUN',
      color: defaults.sun,
      accessory: 'none',
    },
    {
      kind: 'earth',
      name: 'Atlas',
      role: 'EARTH',
      color: defaults.earth,
      accessory: 'glasses',
    },
    {
      kind: 'saturn',
      name: 'Juno',
      role: 'SATURN',
      color: defaults.saturn,
      accessory: 'none',
    },
    {
      kind: 'neptune',
      name: 'Vega',
      role: 'NEPTUNE',
      color: defaults.neptune,
      accessory: 'beret',
    },
  ];
  const accessoryLabels = {
    none: '无配饰',
    glasses: '圆框眼镜',
    beret: '贝雷帽',
    star: '小星星',
  };
  const select = document.querySelector('#active-state');
  const matrixSelect = document.querySelector('#matrix-kind');
  const grid = document.querySelector('#state-grid');
  const pause = document.querySelector('#pause-motion');
  const reduce = document.querySelector('#reduce-motion');
  const cycle = document.querySelector('#cycle');
  const systemReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let currentState = 'thinking';
  let timer;
  const motion = () =>
    reduce.checked || systemReduce.matches
      ? 'reduced'
      : pause.checked
        ? 'paused'
        : 'auto';
  const markup = (character, state = currentState) =>
    render({
      ...character,
      state,
      motion: motion(),
      label: `${character.name} · ${stateInfo[state][0]}`,
    });

  const groups = new Map();
  for (const state of states) {
    const [label, group] = stateInfo[state];
    if (!groups.has(group)) {
      const optionGroup = document.createElement('optgroup');
      optionGroup.label = group;
      groups.set(group, optionGroup);
      select.append(optionGroup);
    }
    const option = document.createElement('option');
    option.value = state;
    option.textContent = label;
    groups.get(group).append(option);
  }
  select.value = currentState;

  function renderCharacter(character) {
    const card = document.querySelector(`#character-${character.kind}`);
    card.querySelector('.hero-avatar').innerHTML = markup(character);
    card.querySelector('.miniatures').innerHTML = [24, 32, 48, 64]
      .map(
        (size) =>
          `<figure>${markup(character)}<figcaption>${size}px</figcaption></figure>`,
      )
      .join('');
    card.querySelectorAll('.miniatures svg').forEach((svg, i) => {
      const size = [24, 32, 48, 64][i];
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('aria-hidden', 'true');
    });
  }

  function renderMatrix() {
    const character = characters.find((c) => c.kind === matrixSelect.value);
    grid.replaceChildren();
    for (const state of states) {
      const [label, group, description] = stateInfo[state];
      const button = document.createElement('button');
      button.className = 'state-cell';
      button.dataset.state = state;
      button.setAttribute('aria-label', `${label}：${description}`);
      button.setAttribute('aria-pressed', String(state === currentState));
      button.innerHTML = `<span class="group">${group}</span>${markup(character, state)}<b>${label}</b><small>${state}</small>`;
      button.querySelector('svg').setAttribute('aria-hidden', 'true');
      button.addEventListener('click', () => {
        stopCycle();
        setState(state);
      });
      grid.append(button);
    }
  }

  for (const character of characters) {
    const card = document.createElement('article');
    card.className = 'character';
    card.id = `character-${character.kind}`;
    card.innerHTML = `<div class="identity"><h2>${character.name}</h2><span>${character.role}</span></div><div class="hero-avatar"></div><div class="customize"><label for="color-${character.kind}">主色<input type="color" id="color-${character.kind}" value="${character.color}" /></label><label for="accessory-${character.kind}">配饰<select id="accessory-${character.kind}">${Object.entries(
      accessoryLabels,
    )
      .map(
        ([value, label]) =>
          `<option value="${value}" ${character.accessory === value ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></label></div><div class="miniatures" aria-label="头像尺寸示例"></div><button class="download">下载 ${character.name} SVG</button>`;
    document.querySelector('#characters').append(card);
    renderCharacter(character);
    card.querySelector('input').addEventListener('input', (event) => {
      character.color = event.target.value;
      card
        .querySelectorAll('svg')
        .forEach((svg) => update(svg, { color: character.color }));
      if (matrixSelect.value === character.kind)
        grid
          .querySelectorAll('svg')
          .forEach((svg) => update(svg, { color: character.color }));
    });
    card.querySelector('select').addEventListener('change', (event) => {
      character.accessory = event.target.value;
      renderCharacter(character);
      if (matrixSelect.value === character.kind) renderMatrix();
    });
    card.querySelector('.download').addEventListener('click', () => {
      // Export the chosen state and palette. Preview pause does not freeze the asset.
      const svg = render({
        ...character,
        state: currentState,
        motion: motion() === 'reduced' ? 'reduced' : 'auto',
        label: `${character.name} · ${stateInfo[currentState][0]}`,
      });
      const url = URL.createObjectURL(
        new Blob([svg], { type: 'image/svg+xml' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${character.kind}-${currentState}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function setState(state) {
    currentState = state;
    select.value = state;
    document
      .querySelector('#characters')
      .querySelectorAll('svg')
      .forEach((svg) => update(svg, { state }));
    grid
      .querySelectorAll('button')
      .forEach((button) =>
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.state === state),
        ),
      );
    document.querySelector('#state-name').textContent = stateInfo[state][0];
    document.querySelector('#state-description').textContent =
      stateInfo[state][2];
  }
  function stopCycle() {
    clearInterval(timer);
    timer = undefined;
    cycle.setAttribute('aria-pressed', 'false');
    cycle.textContent = '轮播状态';
  }
  function applyMotion() {
    document
      .querySelectorAll('svg.tian-avatar')
      .forEach((svg) => update(svg, { motion: motion() }));
    if (motion() !== 'auto') stopCycle();
    cycle.disabled = motion() !== 'auto';
  }
  select.addEventListener('change', () => {
    stopCycle();
    setState(select.value);
  });
  matrixSelect.addEventListener('change', renderMatrix);
  pause.addEventListener('change', applyMotion);
  reduce.addEventListener('change', applyMotion);
  systemReduce.addEventListener('change', applyMotion);
  cycle.addEventListener('click', () => {
    if (timer) {
      stopCycle();
      return;
    }
    cycle.setAttribute('aria-pressed', 'true');
    cycle.textContent = '停止轮播';
    timer = setInterval(
      () =>
        setState(states[(states.indexOf(currentState) + 1) % states.length]),
      2800,
    );
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCycle();
  });
  document.querySelector('#theme-toggle').addEventListener('click', (event) => {
    const night = document.documentElement.dataset.theme !== 'night';
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    event.currentTarget.setAttribute('aria-pressed', String(night));
  });
  renderMatrix();
  setState(currentState);
  applyMotion();
})();
