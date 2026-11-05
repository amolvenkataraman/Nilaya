// Countdown page: ticks down to data-target (ISO time) on .countdown-card; blinks red when past.
(function () {
    'use strict';
    const card = document.querySelector('.countdown-card');
    const target = new Date(card.dataset.target).getTime();
    const box = document.querySelector('.countdown');
    const parts = { day: document.querySelector('.day'), hour: document.querySelector('.hour'), minute: document.querySelector('.minute'), second: document.querySelector('.second') };

    function updateTime() {
        const dist = target - Date.now();
        if (isNaN(target)) return;
        if (dist < 0) {
            box.classList.toggle('is-past', Math.floor((dist % 60000) / 1000) % 2 === 0);
        } else {
            parts.day.textContent = String(Math.floor(dist / 86400000));
            parts.hour.textContent = String(Math.floor((dist % 86400000) / 3600000)).padStart(2, '0');
            parts.minute.textContent = String(Math.floor((dist % 3600000) / 60000)).padStart(2, '0');
            parts.second.textContent = String(Math.floor((dist % 60000) / 1000)).padStart(2, '0');
        }
        setTimeout(updateTime, 1000);
    }

    updateTime();
})();
