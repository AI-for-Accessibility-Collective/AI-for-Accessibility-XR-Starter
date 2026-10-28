// The page tour: a ring around one part of the page at a time, a short note
// beside it, and for some steps a button that does the step. The page stays
// usable during the tour, so people can also do each step themselves.
//
// A step: { target: '#css-selector' or () => selector, title, text,
//   side?: 'below' | 'above' | 'right' | 'left' (where the note goes first),
//   do?: { label, run(), ready?(), done?(), notReady } }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createTour(steps, { onEnd } = {}) {
  const $ = (id) => document.getElementById(id);
  const root = $('tour');
  const dim = root.querySelector('.tour-dim');
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0;
  let open = false;
  let ran = new Set(); // steps whose button was pressed
  let returnFocus = null;
  let frame = 0;

  const targetOf = (step) => {
    const sel = typeof step.target === 'function' ? step.target() : step.target;
    const node = sel ? document.querySelector(sel) : null;
    return node && node.getClientRects().length ? node : null;
  };

  // Put the ring on the step's part of the page and the note beside it:
  // below if it fits, else above, else to one side, else at the bottom.
  function place() {
    if (!open) return;
    const node = targetOf(steps[i]);
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    if (!node) {
      spot.hidden = true;
      dim.hidden = false;
      card.dataset.side = 'none';
      card.style.left = `${(vw - cw) / 2}px`;
      card.style.top = `${Math.max(16, (vh - ch) / 2)}px`;
      return;
    }
    const pad = 6;
    const gap = 16;
    const r = node.getBoundingClientRect();
    spot.hidden = false;
    dim.hidden = true;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const fits = {
      below: () => r.bottom + pad + gap + ch <= vh - 8,
      above: () => r.top - pad - gap - ch >= 8,
      right: () => r.right + pad + gap + cw <= vw - 8,
      left: () => r.left - pad - gap - cw >= 8,
    };
    const order = [...new Set([steps[i].side, 'below', 'above', 'right', 'left'].filter(Boolean))];
    const side = order.find((s) => fits[s]()) ?? 'none';
    let left = (vw - cw) / 2;
    let top = vh - ch - 16;
    if (side === 'below') top = r.bottom + pad + gap;
    if (side === 'above') top = r.top - pad - gap - ch;
    if (side === 'right') left = r.right + pad + gap;
    if (side === 'left') left = r.left - pad - gap - cw;
    if (side === 'below' || side === 'above') left = clamp(r.left + r.width / 2 - cw / 2, 16, vw - cw - 16);
    if (side === 'right' || side === 'left') top = clamp(r.top + Math.min(r.height, vh) / 2 - ch / 2, 16, vh - ch - 16);
    card.dataset.side = side;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.setProperty('--ax', `${clamp(r.left + r.width / 2 - left, 24, cw - 24)}px`);
    card.style.setProperty('--ay', `${clamp(r.top + Math.min(r.height, vh - r.top) / 2 - top, 24, ch - 24)}px`);
  }
  const placeSoon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };

  // The step's button: what it does, whether it can run yet, and whether it ran.
  function renderAction() {
    const step = steps[i];
    const act = $('tour-do');
    const note = $('tour-note');
    if (!step.do) {
      act.hidden = true;
      note.textContent = '';
      return;
    }
    const done = step.do.done ? step.do.done() : ran.has(i);
    const ready = step.do.ready ? step.do.ready() : true;
    act.hidden = false;
    act.disabled = done || !ready;
    act.textContent = done ? '✓ Done' : step.do.label;
    note.textContent = !done && !ready ? step.do.notReady ?? '' : '';
  }

  function render() {
    const step = steps[i];
    $('tour-count').textContent = `Step ${i + 1} of ${steps.length}`;
    $('tour-title').textContent = step.title;
    $('tour-text').textContent = step.text;
    $('tour-back').textContent = i === 0 ? 'Skip the tour' : 'Back';
    $('tour-next').textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    renderAction();
    const node = targetOf(step);
    if (node) node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    place();
    setTimeout(place, reduce ? 0 : 450);
    $('tour-title').focus({ preventScroll: true });
  }

  const go = (n) => {
    if (n >= steps.length) return end();
    i = clamp(n, 0, steps.length - 1);
    render();
  };

  $('tour-next').onclick = () => go(i + 1);
  $('tour-back').onclick = () => (i === 0 ? end() : go(i - 1));
  $('tour-close').onclick = () => end();
  $('tour-do').onclick = async () => {
    const step = steps[i];
    $('tour-do').disabled = true;
    try {
      await step.do.run();
      ran.add(i);
    } finally {
      renderAction();
      placeSoon();
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') end();
  };

  function start() {
    returnFocus = document.activeElement;
    ran = new Set();
    open = true;
    root.hidden = false;
    addEventListener('resize', placeSoon);
    addEventListener('scroll', placeSoon, true);
    addEventListener('keydown', onKey);
    go(0);
  }

  function end() {
    if (!open) return;
    open = false;
    root.hidden = true;
    removeEventListener('resize', placeSoon);
    removeEventListener('scroll', placeSoon, true);
    removeEventListener('keydown', onKey);
    returnFocus?.focus?.();
    onEnd?.();
  }

  // The page changed (connected, started, a new line): update the step's
  // button and follow the part of the page if it moved.
  function refresh() {
    if (!open) return;
    renderAction();
    placeSoon();
  }

  return { start, end, refresh, get open() { return open; } };
}
