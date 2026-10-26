
  // Applied synchronously, before the stylesheet paints, so there's no
  // flash of the wrong theme on load. Reads localStorage directly rather
  // than through the app's `storage` wrapper (defined later, and async)
  // since this needs to run immediately. Sets the data-theme attribute
  // for the shared stylesheet. The stylesheet owns all page colors.
  (function(){
    try {
      const saved = localStorage.getItem('bearden:classic:theme');
      if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
      const savedHoliday = localStorage.getItem('bearden:classic:holiday');
      if (savedHoliday === 'christmas' || savedHoliday === 'halloween') {
        document.documentElement.setAttribute('data-holiday', savedHoliday);
      }
    } catch (e) {}
  })();
