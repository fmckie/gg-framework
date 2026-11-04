for (const sample of document.querySelectorAll('#conversation, #empty')) {
  const trigger = sample.querySelector('.context-control');
  const value = Number.parseInt(trigger.querySelector('.context-value').textContent, 10);
  const id = `${sample.id}-usage`;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', id);
  const fillColor = `hsl(${120 * (1 - value / 100)} 70% 65%)`;
  trigger.querySelector('.context-track i').style.width = `${value}%`;
  trigger.querySelector('.context-track i').style.backgroundColor = fillColor;
  const popover = document.createElement('div');
  popover.id = id;
  popover.className = 'usage-popover';
  popover.setAttribute('popover', 'manual');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-labelledby', `${id}-title`);
  popover.setAttribute('aria-describedby', `${id}-note`);
  popover.innerHTML = `<header><h3 id="${id}-title">Usage</h3><button type="button" class="control usage-close" aria-label="Close Usage">×</button></header><p><span>Current conversation context</span><strong>${value}%</strong></p><div class="usage-meter" role="meter" aria-label="Current conversation context" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-valuetext="${value}% of context occupied — illustrative"><i style="width:${value}%"></i></div><small id="${id}-note">Illustrative sample data</small>`;
  popover.querySelector('.usage-meter i').style.backgroundColor = fillColor;
  trigger.after(popover);
  const closeButton = popover.querySelector('.usage-close');
  const isOpen = () => popover.matches(':popover-open');
  function position() {
    if (!isOpen()) return;
    const bounds = trigger.getBoundingClientRect();
    const width = popover.getBoundingClientRect().width;
    popover.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - width - 12))}px`;
    popover.style.top = `${bounds.top - popover.offsetHeight - 8}px`;
  }
  function close(restoreFocus) {
    if (!isOpen()) return;
    popover.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  trigger.addEventListener('click', () => {
    if (isOpen()) { close(true); return; }
    popover.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    position();
    closeButton.focus({ preventScroll: true });
  });
  closeButton.addEventListener('click', () => close(true));
  // Capture Escape before the underlying Model/More/Branch panel can consume it.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close(true);
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!popover.contains(event.target) && !trigger.contains(event.target)) close(false);
  }, true);
  document.addEventListener('focusin', event => {
    if (!popover.contains(event.target) && !trigger.contains(event.target)) close(false);
  });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
}
