/* Own profile page (users/profile.html): edit details, crop + upload a new profile picture.
 * Endpoints come from data-* on the modals; CSRF from the csrftoken cookie (csrfToken() in script.js).
 * Uses Croppie's plain-JS API (no jQuery). One Croppie instance is created on first use and
 * re-bound for later images, and the rotate buttons are wired once. */
(function () {
    var croppie = null;

    function readFile(input, cropArea) {
        if (!(input.files && input.files[0])) return;
        if (!window.FileReader) {
            alert("Sorry - your browser doesn't support the FileReader API");
            return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
            if (!croppie) {
                croppie = new Croppie(cropArea, {
                    viewport: { width: 200, height: 200, type: 'square' },
                    enableOrientation: true,
                });
            }
            croppie.bind({ url: e.target.result });
        };
        reader.readAsDataURL(input.files[0]);
    }

    function upload(url, button) {
        if (!croppie) return;  // nothing chosen yet
        button.disabled = true;
        croppie.result({ type: 'canvas', size: 'viewport' }).then(function (resp) {
            var request = new XMLHttpRequest();
            request.open('POST', url);
            request.setRequestHeader("X-CSRFToken", csrfToken());
            request.onload = function () {
                var res = null;
                try { res = JSON.parse(request.responseText); } catch (e) { /* not JSON */ }
                if (res && res.status !== 'success') {
                    button.disabled = false;
                    alert(res.data || "Couldn't upload the picture");
                    return;
                }
                window.location.reload();
            };
            request.onerror = function () { button.disabled = false; alert("Couldn't upload the picture"); };
            request.send(resp);
        });
    }

    function updateProfile(url) {
        var result = {
            "username": document.getElementById('username-input').value,
            "first_name": document.getElementById('first-name-input').value,
            "last_name": document.getElementById('last-name-input').value,
            "description": document.getElementById('description-input').value,
        };

        var r = new XMLHttpRequest();
        r.open("POST", url);
        r.setRequestHeader("X-CSRFToken", csrfToken());
        r.onload = function () {
            var res = JSON.parse(r.responseText);
            if (res['status'] == 'success') {
                window.location.reload();
            }
            else {
                alert(res['data']);
            }
        };
        r.send(JSON.stringify(result));
    }

    document.addEventListener('DOMContentLoaded', function () {
        var picModal = document.getElementById('changeProfilePictureModal');
        if (picModal) {
            var cropArea = picModal.querySelector('.image-crop-area');
            picModal.querySelector('#formFile').addEventListener('change', function () { readFile(this, cropArea); });
            picModal.querySelectorAll('.rotate-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    if (croppie) croppie.rotate(parseInt(btn.dataset.deg, 10));
                });
            });
            var uploadBtn = picModal.querySelector('.upload-btn');
            uploadBtn.addEventListener('click', function () { upload(picModal.dataset.uploadUrl, uploadBtn); });
        }

        var editModal = document.getElementById('changeProfileModal');
        if (editModal) {
            editModal.querySelector('.update-profile-btn').addEventListener('click', function () {
                updateProfile(editModal.dataset.profileUrl);
            });
        }
    });
})();
