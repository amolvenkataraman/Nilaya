document.addEventListener('DOMContentLoaded', () => {
    console.log('%c WARNING! ', 'color: red; font-size: 32px; font-weight: 600;');
    console.log('DO NOT type or paste ANYTHING in this window. Doing so can allow hackers to access your data.');

    if (!localStorage.getItem('debug')) {
        localStorage.setItem('debug', 0)
    }
});

function toggle_dark_mode() {
    r = new XMLHttpRequest();
    r.open("POST", "{% url 'dark_mode' %}");
    r.setRequestHeader("X-CSRFToken", "{{ csrf_token }}");
    r.onload = () => {window.location.reload();}
    r.send();
}
 