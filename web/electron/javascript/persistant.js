const sidebarSearchInput = document.getElementById('sidebar-search');
if (sidebarSearchInput) {
    sidebarSearchInput.addEventListener('input', () => {
        if (typeof window.applyLibrarySearch === 'function') {
            window.applyLibrarySearch(sidebarSearchInput.value);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-nav]').forEach(button => {
    button.addEventListener('click', () => {
      const targetPage = button.dataset.nav;
      window.location.replace(`../html/${targetPage}.html`);
    });
  });

  const currentFileName = window.location.pathname
    .split('/')
    .pop()
    .replace('.html', '');


  const sidebarButtons = document.querySelectorAll('.sidebar_main_btn, .sidebar_btn');

  sidebarButtons.forEach(button => {

    button.classList.remove('active');


    if (button.id === currentFileName) {
      button.classList.add('active');
    }
  });
});

