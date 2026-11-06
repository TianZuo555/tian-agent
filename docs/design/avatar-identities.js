/* The SVG study is the single source for identities in both mockups. */
(() => {
  const characters = {
    atlas: { kind: 'earth', accessory: 'glasses', name: 'Atlas' },
    juno: { kind: 'saturn', accessory: 'none', name: 'Juno' },
    vega: { kind: 'neptune', accessory: 'beret', name: 'Vega' },
  };
  function refresh(element) {
    const chief = element.classList.contains('orb');
    const hue = element.style.getPropertyValue('--hue');
    const identity = chief
      ? 'chief'
      : /juno/.test(hue)
        ? 'juno'
        : /vega/.test(hue)
          ? 'vega'
          : 'atlas';
    const state = element.classList.contains('off')
      ? 'offline'
      : element.classList.contains('block')
        ? 'blocked'
        : element.classList.contains('wait')
          ? 'waiting'
          : element.classList.contains('idle')
            ? 'sleeping'
            : element.classList.contains('thinking')
              ? 'thinking'
              : chief
                ? 'idle'
                : 'working';
    const current = element.querySelector(':scope > .tian-avatar');
    if (current) {
      globalThis.TianAvatar.update(current, { state });
      return;
    }
    element.dataset.avatar = identity;
    element.insertAdjacentHTML(
      'beforeend',
      globalThis.TianAvatar.render({
        ...(chief ? { kind: 'sun', name: 'Chief' } : characters[identity]),
        state,
      }),
    );
    const svg = element.querySelector(':scope > .tian-avatar');
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    svg.removeAttribute('aria-label');
  }
  const identities = document.querySelectorAll('.orb, .planet');
  identities.forEach(refresh);
  const observer = new MutationObserver((records) => {
    for (const record of records) refresh(record.target);
  });
  identities.forEach((element) =>
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['class'],
    }),
  );
})();
