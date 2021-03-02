var parser = new UAParser()
var oldbrowsers = ['Amaya', 'AOL Explorer', 'Arora', 'Camino', 'ELinks', 'Flock', 'Galeon', 'IE', 'IEMobile', 'K-Meleon', 'Lunascape', 'Mosaic', 'Mozilla Application Suite',
'Netscape', 'NokiaBrowser', 'Omniweb', 'Origyn', 'rekonq', 'Shiira', 'surf', 'Uzbl', 'WorldWideWeb', 'Nexus']
var goodbrowsers = ['Android Browser', 'Brave', 'Chrome', 'Chromium', 'Edge', 'Firefox', 'Opera', 'Safari', 'Samsung Browser', 'Waterfox']

document.addEventListener('DOMContentLoaded', () => {
    data__ = parser.getResult()

    if (oldbrowsers.includes(data__["browser"]["name"])) {
        document.querySelector('.browser-modal-header').innerHTML = "⚠️ WARNING: Unsafe browser detected"
        document.querySelector('.browser-modal-body').innerHTML = `It has been detected that you are using an old, unsafe browser (${data__["browser"]["name"]}). 
        Not only is using this browser a security risk, as it is no longer updated to patch bugs, 
        but it also does not support many of the features that this website uses, 
        which can lead to errors, unresponsive pages, and some regions of pages not loading like they should. 
        Please switch to a newer browser (like Chrome, Firefox, Opera, Safari or Edge) to use this website.`
        document.querySelector('.browser-modal-toggle').click()
    }
    else if (!goodbrowsers.includes(data__["browser"]["name"])) {
        document.querySelector('.browser-modal-header').innerHTML = "⚠️ WARNING: Unsupported browser detected"
        document.querySelector('.browser-modal-body').innerHTML = `It has been detected that you are using an unsupported browser (${data__["browser"]["name"]}). 
        This website has been tested to work with all common, modern browsers, but the browser that you are using has not been tested. 
        Using this browser might cause unresponsive pages, bad layouts, and some regions of pages not loading like they should. 
        It is recommended that you switch to a more common, tested browser (like Chrome, Firefox, Opera, Safari or Edge) to use this website.
        <br><br>
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>`
        document.querySelector('.browser-modal-toggle').click()
    }
})
