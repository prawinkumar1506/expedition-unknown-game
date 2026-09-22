(() => {
  const STORAGE_KEY = 'clearway-sidebar-collapsed';
  const shell = document.querySelector('.shell');
  const sidebar = document.querySelector('.d-sidebar');
  const topbar = document.querySelector('.d-topbar');
  if (!shell || !sidebar || !topbar) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sidebar-toggle';
  button.setAttribute('aria-label', 'Hide sidebar');
  button.setAttribute('aria-expanded', 'true');
  button.innerHTML = '<span></span><span></span><span></span>';
  topbar.prepend(button);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.appendChild(backdrop);

  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

  function setDesktopCollapsed(collapsed) {
    shell.classList.toggle('sidebar-collapsed', collapsed);
    button.classList.toggle('is-collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Show sidebar' : 'Hide sidebar');
    if (!isMobile()) localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }

  function setMobileOpen(open) {
    document.body.classList.toggle('has-sidebar-open', open);
    button.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar');
  }

  const savedCollapsed = localStorage.getItem(STORAGE_KEY) === '1';
  if (isMobile()) setMobileOpen(false);
  else setDesktopCollapsed(savedCollapsed);

  button.addEventListener('click', () => {
    if (isMobile()) setMobileOpen(!document.body.classList.contains('has-sidebar-open'));
    else setDesktopCollapsed(!shell.classList.contains('sidebar-collapsed'));
  });

  backdrop.addEventListener('click', () => setMobileOpen(false));
  sidebar.addEventListener('click', (event) => {
    if (isMobile() && event.target.closest('a, button')) setMobileOpen(false);
  });

  window.addEventListener('resize', () => {
    if (isMobile()) {
      shell.classList.remove('sidebar-collapsed');
      setMobileOpen(false);
    } else {
      document.body.classList.remove('has-sidebar-open');
      setDesktopCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
    }
  });
})();

// Populate the sidebar identity from the team name entered on the join screen.
(() => {
  const nameEl = document.querySelector('#team-profile-name');
  const avatarEl = document.querySelector('#team-avatar');
  const roomEl = document.querySelector('#team-profile-room');
  if (!nameEl) return;
  try {
    const session = JSON.parse(sessionStorage.getItem('expedition-session') || 'null');
    const name = String(session?.player || 'Your team').trim() || 'Your team';
    nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
    if (roomEl) roomEl.textContent = session?.room ? `Room ${session.room}` : 'Control room';
  } catch {
    nameEl.textContent = 'Your team';
  }
})();
