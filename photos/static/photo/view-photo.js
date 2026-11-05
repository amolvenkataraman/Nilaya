/* Single photo/video page (view_photo.html): source and type come from data-* on #photo-display-area. */
(function () {
    const area = document.getElementById("photo-display-area");
    let media;
    if (area.dataset.video === "1") {
        media = document.createElement("video");
        const src = document.createElement("source");
        src.src = area.dataset.src;
        src.type = "video/mp4";
        media.appendChild(src);
        media.controls = true;
        media.loop = true;
    } else {
        media = document.createElement("img");
        media.src = area.dataset.src;
        media.alt = "";
    }
    media.classList.add("image-displayed");
    document.getElementById("photo").replaceChildren(media);
    if (media.tagName === "VIDEO") media.play().catch(() => { });
})();
