/* Day / event photos (day.html, also shown in the calendar's modal): justified grid sizing. */
document.querySelectorAll('.photo-item[data-ar]').forEach(item => item.style.setProperty('--ar', item.dataset.ar));
