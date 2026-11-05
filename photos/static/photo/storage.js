/* Photos > Storage: tab switching and usage-bar widths. */
document.addEventListener("DOMContentLoaded", function () {
    // Usage bars: each segment's share (percent) comes from its data-pct attribute.
    document.querySelectorAll(".ins-bar > [data-pct]").forEach(function (seg) {
        seg.style.width = seg.dataset.pct + "%";
    });

    // Tab switching
    $('.ins-tab').on('click', function () {
        var target = $(this).data('target');
        $('.ins-tab').removeClass('active').attr('aria-selected', 'false');
        $(this).addClass('active').attr('aria-selected', 'true');
        $('.storage-tab-pane').prop('hidden', true);
        $(target).prop('hidden', false);
    });
});
