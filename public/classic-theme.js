
  // Applied synchronously, before the stylesheet paints, so there's no
  // flash of the wrong theme on load. Reads localStorage directly rather
  // than through the app's `storage` wrapper (defined later, and async)
  // since this needs to run immediately. Sets both the data-theme attribute
  // (for the CSS variables) and an inline background-color directly, as a
  // guaranteed fallback in case anything else interferes with the CSS cascade.
  (function(){
    try {
      const saved = localStorage.getItem('bearden:classic:theme');
      if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.backgroundColor = '#102321';
      }
      const savedHoliday = localStorage.getItem('bearden:classic:holiday');
      if (savedHoliday === 'christmas' || savedHoliday === 'halloween') {
        document.documentElement.setAttribute('data-holiday', savedHoliday);
      }
    } catch (e) {}
  })();
