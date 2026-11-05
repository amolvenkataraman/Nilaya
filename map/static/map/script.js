// Escape user-controlled text before interpolating it into innerHTML
function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Bootstrap Icons (MIT, icons.getbootstrap.com): inner SVG markup for the icons used in this script.
const ICON_PATHS = {
    "house-fill": '<path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293z"/> <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293z"/>',
    "building-fill": '<path d="M3 0a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3v-3.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V16h3a1 1 0 0 0 1-1V1a1 1 0 0 0-1-1zm1 2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3.5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5M4 5.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zM7.5 5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5m2.5.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zM4.5 8h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5m2.5.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3.5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5"/>',
    "backpack-fill": '<path d="M5 13v-3h4v.5a.5.5 0 0 0 1 0V10h1v3z"/> <path d="M6 2v.341C3.67 3.165 2 5.388 2 8v5.5A2.5 2.5 0 0 0 4.5 16h7a2.5 2.5 0 0 0 2.5-2.5V8a6 6 0 0 0-4-5.659V2a2 2 0 1 0-4 0m2-1a1 1 0 0 1 1 1v.083a6 6 0 0 0-2 0V2a1 1 0 0 1 1-1m0 3a4 4 0 0 1 3.96 3.43.5.5 0 1 1-.99.14 3 3 0 0 0-5.94 0 .5.5 0 1 1-.99-.14A4 4 0 0 1 8 4M4.5 9h7a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5"/>',
    "mortarboard-fill": '<path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917z"/> <path d="M4.176 9.032a.5.5 0 0 0-.656.327l-.5 1.7a.5.5 0 0 0 .294.605l4.5 1.8a.5.5 0 0 0 .372 0l4.5-1.8a.5.5 0 0 0 .294-.605l-.5-1.7a.5.5 0 0 0-.656-.327L8 10.466z"/>',
    "cup-hot-fill": '<path fill-rule="evenodd" d="M.5 6a.5.5 0 0 0-.488.608l1.652 7.434A2.5 2.5 0 0 0 4.104 16h5.792a2.5 2.5 0 0 0 2.44-1.958l.131-.59a3 3 0 0 0 1.3-5.854l.221-.99A.5.5 0 0 0 13.5 6zM13 12.5a2 2 0 0 1-.316-.025l.867-3.898A2.001 2.001 0 0 1 13 12.5"/> <path d="m4.4.8-.003.004-.014.019a4 4 0 0 0-.204.31 2 2 0 0 0-.141.267c-.026.06-.034.092-.037.103v.004a.6.6 0 0 0 .091.248c.075.133.178.272.308.445l.01.012c.118.158.26.347.37.543.112.2.22.455.22.745 0 .188-.065.368-.119.494a3 3 0 0 1-.202.388 5 5 0 0 1-.253.382l-.018.025-.005.008-.002.002A.5.5 0 0 1 3.6 4.2l.003-.004.014-.019a4 4 0 0 0 .204-.31 2 2 0 0 0 .141-.267c.026-.06.034-.092.037-.103a.6.6 0 0 0-.09-.252A4 4 0 0 0 3.6 2.8l-.01-.012a5 5 0 0 1-.37-.543A1.53 1.53 0 0 1 3 1.5c0-.188.065-.368.119-.494.059-.138.134-.274.202-.388a6 6 0 0 1 .253-.382l.025-.035A.5.5 0 0 1 4.4.8m3 0-.003.004-.014.019a4 4 0 0 0-.204.31 2 2 0 0 0-.141.267c-.026.06-.034.092-.037.103v.004a.6.6 0 0 0 .091.248c.075.133.178.272.308.445l.01.012c.118.158.26.347.37.543.112.2.22.455.22.745 0 .188-.065.368-.119.494a3 3 0 0 1-.202.388 5 5 0 0 1-.253.382l-.018.025-.005.008-.002.002A.5.5 0 0 1 6.6 4.2l.003-.004.014-.019a4 4 0 0 0 .204-.31 2 2 0 0 0 .141-.267c.026-.06.034-.092.037-.103a.6.6 0 0 0-.09-.252A4 4 0 0 0 6.6 2.8l-.01-.012a5 5 0 0 1-.37-.543A1.53 1.53 0 0 1 6 1.5c0-.188.065-.368.119-.494.059-.138.134-.274.202-.388a6 6 0 0 1 .253-.382l.025-.035A.5.5 0 0 1 7.4.8m3 0-.003.004-.014.019a4 4 0 0 0-.204.31 2 2 0 0 0-.141.267c-.026.06-.034.092-.037.103v.004a.6.6 0 0 0 .091.248c.075.133.178.272.308.445l.01.012c.118.158.26.347.37.543.112.2.22.455.22.745 0 .188-.065.368-.119.494a3 3 0 0 1-.202.388 5 5 0 0 1-.252.382l-.019.025-.005.008-.002.002A.5.5 0 0 1 9.6 4.2l.003-.004.014-.019a4 4 0 0 0 .204-.31 2 2 0 0 0 .141-.267c.026-.06.034-.092.037-.103a.6.6 0 0 0-.09-.252A4 4 0 0 0 9.6 2.8l-.01-.012a5 5 0 0 1-.37-.543A1.53 1.53 0 0 1 9 1.5c0-.188.065-.368.119-.494.059-.138.134-.274.202-.388a6 6 0 0 1 .253-.382l.025-.035A.5.5 0 0 1 10.4.8"/>',
    "shop": '<path d="M2.97 1.35A1 1 0 0 1 3.73 1h8.54a1 1 0 0 1 .76.35l2.609 3.044A1.5 1.5 0 0 1 16 5.37v.255a2.375 2.375 0 0 1-4.25 1.458A2.37 2.37 0 0 1 9.875 8 2.37 2.37 0 0 1 8 7.083 2.37 2.37 0 0 1 6.125 8a2.37 2.37 0 0 1-1.875-.917A2.375 2.375 0 0 1 0 5.625V5.37a1.5 1.5 0 0 1 .361-.976zm1.78 4.275a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 1 0 2.75 0V5.37a.5.5 0 0 0-.12-.325L12.27 2H3.73L1.12 5.045A.5.5 0 0 0 1 5.37v.255a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0M1.5 8.5A.5.5 0 0 1 2 9v6h1v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5h6V9a.5.5 0 0 1 1 0v6h.5a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1H1V9a.5.5 0 0 1 .5-.5M4 15h3v-5H4zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1zm3 0h-2v3h2z"/>',
    "bag-fill": '<path d="M8 1a2.5 2.5 0 0 1 2.5 2.5V4h-5v-.5A2.5 2.5 0 0 1 8 1m3.5 3v-.5a3.5 3.5 0 1 0-7 0V4H1v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4z"/>',
    "p-square-fill": '<path d="M8.27 8.074c.893 0 1.419-.545 1.419-1.488s-.526-1.482-1.42-1.482H6.778v2.97z"/> <path d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zm3.5 4.002h2.962C10.045 4.002 11 5.104 11 6.586c0 1.494-.967 2.578-2.55 2.578H6.784V12H5.5z"/>',
    "bank2": '<path d="M8.277.084a.5.5 0 0 0-.554 0l-7.5 5A.5.5 0 0 0 .5 6h1.875v7H1.5a.5.5 0 0 0 0 1h13a.5.5 0 1 0 0-1h-.875V6H15.5a.5.5 0 0 0 .277-.916zM12.375 6v7h-1.25V6zm-2.5 0v7h-1.25V6zm-2.5 0v7h-1.25V6zm-2.5 0v7h-1.25V6zM8 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2M.5 15a.5.5 0 0 0 0 1h15a.5.5 0 1 0 0-1z"/>',
    "hospital-fill": '<path d="M6 0a1 1 0 0 0-1 1v1a1 1 0 0 0-1 1v4H1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h6v-2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5V16h6a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3V3a1 1 0 0 0-1-1V1a1 1 0 0 0-1-1zm2.5 5.034v1.1l.953-.55.5.867L9 7l.953.55-.5.866-.953-.55v1.1h-1v-1.1l-.953.55-.5-.866L7 7l-.953-.55.5-.866.953.55v-1.1zM2.25 9h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 2 9.75v-.5A.25.25 0 0 1 2.25 9m0 2h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5a.25.25 0 0 1 .25-.25M2 13.25a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zM13.25 9h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5a.25.25 0 0 1 .25-.25M13 11.25a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm.25 1.75h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25v-.5a.25.25 0 0 1 .25-.25"/>',
    "train-front-fill": '<path d="M10.621.515C8.647.02 7.353.02 5.38.515c-.924.23-1.982.766-2.78 1.22C1.566 2.322 1 3.432 1 4.582V13.5A2.5 2.5 0 0 0 3.5 16h9a2.5 2.5 0 0 0 2.5-2.5V4.583c0-1.15-.565-2.26-1.6-2.849-.797-.453-1.855-.988-2.779-1.22ZM6.5 2h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1m-2 2h7A1.5 1.5 0 0 1 13 5.5v2A1.5 1.5 0 0 1 11.5 9h-7A1.5 1.5 0 0 1 3 7.5v-2A1.5 1.5 0 0 1 4.5 4m.5 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0m0 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0m8 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3-1a1 1 0 1 1 0 2 1 1 0 0 1 0-2M4 5.5a.5.5 0 0 1 .5-.5h3v3h-3a.5.5 0 0 1-.5-.5zM8.5 8V5h3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5z"/>',
    "tree-fill": '<path d="M8.416.223a.5.5 0 0 0-.832 0l-3 4.5A.5.5 0 0 0 5 5.5h.098L3.076 8.735A.5.5 0 0 0 3.5 9.5h.191l-1.638 3.276a.5.5 0 0 0 .447.724H7V16h2v-2.5h4.5a.5.5 0 0 0 .447-.724L12.31 9.5h.191a.5.5 0 0 0 .424-.765L10.902 5.5H11a.5.5 0 0 0 .416-.777z"/>',
    "image-alt": '<path d="M7 2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0m4.225 4.053a.5.5 0 0 0-.577.093l-3.71 4.71-2.66-2.772a.5.5 0 0 0-.63.062L.002 13v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5z"/>',
    "pencil": '<path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"/>',
    "trash3": '<path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/>',
    "globe2": '<path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855q-.215.403-.395.872c.705.157 1.472.257 2.282.287zM4.249 3.539q.214-.577.481-1.078a7 7 0 0 1 .597-.933A7 7 0 0 0 3.051 3.05q.544.277 1.198.49zM3.509 7.5c.036-1.07.188-2.087.436-3.008a9 9 0 0 1-1.565-.667A6.96 6.96 0 0 0 1.018 7.5zm1.4-2.741a12.3 12.3 0 0 0-.4 2.741H7.5V5.091c-.91-.03-1.783-.145-2.591-.332M8.5 5.09V7.5h2.99a12.3 12.3 0 0 0-.399-2.741c-.808.187-1.681.301-2.591.332zM4.51 8.5c.035.987.176 1.914.399 2.741A13.6 13.6 0 0 1 7.5 10.91V8.5zm3.99 0v2.409c.91.03 1.783.145 2.591.332.223-.827.364-1.754.4-2.741zm-3.282 3.696q.18.469.395.872c.552 1.035 1.218 1.65 1.887 1.855V11.91c-.81.03-1.577.13-2.282.287zm.11 2.276a7 7 0 0 1-.598-.933 9 9 0 0 1-.481-1.079 8.4 8.4 0 0 0-1.198.49 7 7 0 0 0 2.276 1.522zm-1.383-2.964A13.4 13.4 0 0 1 3.508 8.5h-2.49a6.96 6.96 0 0 0 1.362 3.675c.47-.258.995-.482 1.565-.667m6.728 2.964a7 7 0 0 0 2.275-1.521 8.4 8.4 0 0 0-1.197-.49 9 9 0 0 1-.481 1.078 7 7 0 0 1-.597.933M8.5 11.909v3.014c.67-.204 1.335-.82 1.887-1.855q.216-.403.395-.872A12.6 12.6 0 0 0 8.5 11.91zm3.555-.401c.57.185 1.095.409 1.565.667A6.96 6.96 0 0 0 14.982 8.5h-2.49a13.4 13.4 0 0 1-.437 3.008M14.982 7.5a6.96 6.96 0 0 0-1.362-3.675c-.47.258-.995.482-1.565.667.248.92.4 1.938.437 3.008zM11.27 2.461q.266.502.482 1.078a8.4 8.4 0 0 0 1.196-.49 7 7 0 0 0-2.275-1.52c.218.283.418.597.597.932m-.488 1.343a8 8 0 0 0-.395-.872C9.835 1.897 9.17 1.282 8.5 1.077V4.09c.81-.03 1.577-.13 2.282-.287z"/>',
    "lock-fill": '<path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2m3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2"/>',
    "dot": '<circle cx="8" cy="8" r="3.5"/>'
};

// Inline SVG icon (inherits the text colour)
function svgIcon(name, size = 16) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/**
 * Map Application Javascript
 * Organised, modularised, and cleaned up version of the map app script.
 */

const MapApp = {
    Config: {
        // Category glyphs (inline SVG), used in map pins, popups and the sidebar list
        categoryIcons: {
            'house': svgIcon('house-fill'),
            'business': svgIcon('building-fill'),
            'school': svgIcon('backpack-fill'),
            'university': svgIcon('mortarboard-fill'),
            'restaurant': svgIcon('cup-hot-fill'),
            'shop': svgIcon('shop'),
            'mall': svgIcon('bag-fill'),
            'parking': svgIcon('p-square-fill'),
            'religious': svgIcon('bank2'),
            'hospital': svgIcon('hospital-fill'),
            'transit': svgIcon('train-front-fill'),
            'park': svgIcon('tree-fill'),
            'nature': svgIcon('image-alt'),
            'other': svgIcon('dot')
        },
        defaultLocation: [43.4643, -80.5204], // Default to Waterloo if geo fails
        defaultZoom: 13
    },

    State: {
        markersByGroup: {},
        groupLayers: {},
        addLocationMode: false,
        locationGroups: [],
        currentHeatmap: null,
        heatmapAbortController: null
    },

    // API Services
    Service: {
        getCsrfToken() {
            return window.CSRF_TOKEN || '';
        },

        async fetchLocationGroups() {
            try {
                const response = await fetch('/map/location-groups/');
                if (!response.ok) throw new Error('Failed to load location groups');
                const groups = await response.json();
                MapApp.State.locationGroups = groups;
                MapApp.UI.renderGroupsList(groups);
            } catch (error) {
                console.error('Error fetching location groups:', error);
                alert('Could not retrieve location groups from server.');
            }
        },

        async fetchLocationsForGroup(groupId) {
            try {
                const response = await fetch(`/map/locations/?group=${groupId}`);
                if (!response.ok) throw new Error('Failed to load locations');
                const locations = await response.json();

                // Render layers on map
                MapApp.Map.renderGroupMarkers(groupId, locations);

                // Render lists in sidebar if option is checked
                MapApp.UI.renderGroupLocationsInSidebar(groupId, locations);
            } catch (error) {
                console.error(`Error fetching locations for group ${groupId}:`, error);
            }
        },

        async saveLocation(data) {
            const url = data.id ? `/map/locations/${data.id}/edit/` : '/map/locations/add/';
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': this.getCsrfToken()
                    },
                    body: JSON.stringify({
                        ...data,
                        group_id: data.group
                    })
                });
                const res = await response.json();
                if (res.status === 'success') {
                    MapApp.UI.closeLocationModal();
                    await this.fetchLocationGroups();
                    
                    // Refresh map layers for the modified group
                    if (data.group && MapApp.State.groupLayers[data.group]) {
                        await this.fetchLocationsForGroup(data.group);
                    }
                } else {
                    alert('Error saving location: ' + res.data);
                }
            } catch (error) {
                console.error('Error saving location:', error);
                alert('Network error while saving location.');
            }
        },

        async deleteLocation(locationId, groupId = null) {
            try {
                const response = await fetch(`/map/locations/${locationId}/delete/`, {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': this.getCsrfToken()
                    }
                });
                const res = await response.json();
                if (res.status === 'success') {
                    await this.fetchLocationGroups();
                    if (groupId) {
                        await this.fetchLocationsForGroup(groupId);
                    } else {
                        // Refresh all loaded groups
                        for (const gId of Object.keys(MapApp.State.groupLayers)) {
                            await this.fetchLocationsForGroup(gId);
                        }
                    }
                } else {
                    alert('Error deleting location: ' + res.data);
                }
            } catch (error) {
                console.error('Error deleting location:', error);
                alert('Network error while deleting location.');
            }
        },

        async saveGroup(data) {
            try {
                const response = await fetch('/map/location-groups/add/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': this.getCsrfToken()
                    },
                    body: JSON.stringify(data)
                });
                const res = await response.json();
                if (res.status === 'success') {
                    MapApp.UI.closeGroupModal();
                    await this.fetchLocationGroups();
                } else {
                    alert('Error creating group: ' + res.data);
                }
            } catch (error) {
                console.error('Error creating group:', error);
                alert('Network error while creating group.');
            }
        },

        async searchLocation(query) {
            try {
                const response = await fetch(`/map/nominatim/search/?q=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error('Geocoding search failed');
                return await response.json();
            } catch (error) {
                console.error('Error searching location:', error);
                return [];
            }
        }
    },

    // Map Functions
    Map: {
        init() {
            this.leafletMap = L.map('mapid').setView(MapApp.Config.defaultLocation, 2);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(this.leafletMap);

            this.setupMapClick();
            this.locateUser();
        },

        setupMapClick() {
            this.leafletMap.on('click', (e) => {
                if (MapApp.State.addLocationMode) {
                    MapApp.UI.showLocationModal({
                        id: '',
                        name: '',
                        category: '',
                        description: '',
                        address: '',
                        rating: '',
                        latitude: e.latlng.lat,
                        longitude: e.latlng.lng,
                        group_id: ''
                    });
                    
                    // Automatically toggle off mode
                    MapApp.State.addLocationMode = false;
                    document.getElementById('add-location-mode').classList.remove('active');
                    this.leafletMap.getContainer().style.cursor = '';
                }
            });
        },

        locateUser() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(position => {
                    const userLocation = [position.coords.latitude, position.coords.longitude];
                    this.leafletMap.setView(userLocation, MapApp.Config.defaultZoom);
                    
                    const userIcon = L.divIcon({
                        html: `<div class="user-location-dot"></div>`,
                        className: 'custom-div-icon',
                        iconSize: [18, 18],
                        iconAnchor: [9, 9]
                    });

                    L.marker(userLocation, {
                        icon: userIcon,
                        title: 'Your Location'
                    }).addTo(this.leafletMap);
                }, () => {
                    console.log("Geolocation permission denied or timed out.");
                });
            }
        },

        createCustomIcon(category) {
            const icon = MapApp.Config.categoryIcons[category] || MapApp.Config.categoryIcons['other'];
            return L.divIcon({
                html: `<div class="map-pin"><svg class="map-pin-shape" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 1C6.8 1 1 6.7 1 13.7 1 23.2 14 35 14 35s13-11.8 13-21.3C27 6.7 21.2 1 14 1z"/></svg><span class="map-pin-glyph">${icon}</span></div>`,
                className: 'custom-div-icon',
                iconSize: [28, 36],
                iconAnchor: [14, 35],
                popupAnchor: [0, -32]
            });
        },

        renderGroupMarkers(groupId, locations) {
            // Remove existing layers for this group
            if (MapApp.State.groupLayers[groupId]) {
                this.leafletMap.removeLayer(MapApp.State.groupLayers[groupId]);
            }

            const markers = [];
            locations.forEach(location => {
                const marker = L.marker([location.latitude, location.longitude], {
                    icon: this.createCustomIcon(location.category)
                });

                // Build modern custom popup element
                const popupDiv = document.createElement('div');
                popupDiv.className = 'popup-details';
                
                const icon = MapApp.Config.categoryIcons[location.category] || MapApp.Config.categoryIcons['other'];
                const starRating = location.rating ? '★'.repeat(location.rating) + '☆'.repeat(5 - location.rating) : '';
                
                popupDiv.innerHTML = `
                    <div class="popup-icon">${icon}</div>
                    <strong class="popup-title">${esc(location.name)}</strong>
                    <div class="popup-category">${esc(location.category)}</div>
                    ${location.description ? `<div class="popup-desc">${esc(location.description)}</div>` : ''}
                    ${location.address ? `<div class="popup-addr">${esc(location.address)}</div>` : ''}
                    ${location.rating ? `<div class="popup-rating" title="${location.rating} / 5">${starRating}</div>` : ''}
                    <div class="popup-actions-row">
                        <button class="btn btn-sm btn-outline-secondary edit-popup-btn">${svgIcon('pencil', 13)} Edit</button>
                        <button class="btn btn-sm btn-outline-danger delete-popup-btn">${svgIcon('trash3', 13)} Delete</button>
                    </div>
                `;

                // Add popup click events
                popupDiv.querySelector('.edit-popup-btn').addEventListener('click', () => {
                    marker.closePopup();
                    MapApp.UI.showLocationModal(location);
                });
                
                popupDiv.querySelector('.delete-popup-btn').addEventListener('click', () => {
                    if (confirm(`Are you sure you want to delete "${location.name}"?`)) {
                        marker.closePopup();
                        MapApp.Service.deleteLocation(location.id, groupId);
                    }
                });

                marker.bindPopup(popupDiv);
                markers.push(marker);
            });

            if (markers.length > 0) {
                MapApp.State.groupLayers[groupId] = L.layerGroup(markers).addTo(this.leafletMap);
            }
        },

        toggleGroupVisibility(groupId, visible) {
            if (MapApp.State.groupLayers[groupId]) {
                if (visible) {
                    this.leafletMap.addLayer(MapApp.State.groupLayers[groupId]);
                    MapApp.Service.fetchLocationsForGroup(groupId);
                } else {
                    this.leafletMap.removeLayer(MapApp.State.groupLayers[groupId]);
                    const groupDiv = document.getElementById(`group-${groupId}`);
                    if (groupDiv) groupDiv.innerHTML = '';
                    delete MapApp.State.groupLayers[groupId];
                }
            } else if (visible) {
                MapApp.Service.fetchLocationsForGroup(groupId);
            }
        },

        loadHeatmap(useDefaults = true) {
            if (MapApp.State.heatmapAbortController) {
                MapApp.State.heatmapAbortController.abort();
            }
            MapApp.State.heatmapAbortController = new AbortController();

            if (MapApp.State.currentHeatmap) {
                this.leafletMap.removeLayer(MapApp.State.currentHeatmap);
                MapApp.State.currentHeatmap = null;
            }

            const params = new URLSearchParams();
            params.append('vals', '1');

            if (useDefaults) {
                params.append('alt-', '1000');
            } else {
                const yearFilter = document.getElementById('year-filter').value;
                const yearMode = document.getElementById('year-mode').checked;
                const altitudeFilter = document.getElementById('altitude-filter').value;
                const specialOnly = document.getElementById('special-only').checked;

                if (yearMode) {
                    params.append('year', yearFilter);
                } else {
                    params.append('year-', yearFilter);
                }

                if (altitudeFilter === "0") {
                    params.append('alt-', 'NIL');
                } else {
                    params.append('alt-', altitudeFilter);
                }

                if (specialOnly) {
                    params.append('special', '1');
                }
            }

            fetch(`/photos/map/?${params.toString()}`, { signal: MapApp.State.heatmapAbortController.signal })
                .then(response => response.json())
                .then(data => {
                    const points = [];
                    for (const c of data['coords']) {
                        if (c[0] !== 0 && c[1] !== 0) {
                            points.push([c[0], c[1], 1]);
                        }
                    }

                    if (MapApp.State.currentHeatmap) {
                        this.leafletMap.removeLayer(MapApp.State.currentHeatmap);
                    }

                    // ?style=dot restores the original per-photo dot heatmap
                    // (heatmap.js / HeatmapOverlay); anything else uses the
                    // modern blurred "blob" heatmap.
                    const mapStyle = new URLSearchParams(window.location.search).get('style');

                    if (mapStyle === 'dot') {
                        const heatmapLayer = new HeatmapOverlay({
                            radius: 7,
                            maxOpacity: 0.9,
                            scaleRadius: false,
                            useLocalExtrema: true,
                            latField: 'lat',
                            lngField: 'lng',
                            valueField: 'count'
                        });
                        heatmapLayer.addTo(this.leafletMap);
                        heatmapLayer.setData({
                            max: 1,
                            data: points.map(p => ({ lat: p[0], lng: p[1], count: p[2] }))
                        });
                        MapApp.State.currentHeatmap = heatmapLayer;
                    } else {
                        MapApp.State.currentHeatmap = L.heatLayer(points, {
                            minOpacity: 0.3,
                            radius: 25,
                            blur: 20,
                            max: 1
                        }).addTo(this.leafletMap);
                    }
                })
                .catch(err => {
                    if (err.name === 'AbortError') return;
                    console.error('Error loading heatmap:', err);
                });
        }
    },

    // UI Rendering and Controllers
    UI: {
        init() {
            // Register Handlebars helper
            Handlebars.registerHelper('eq', function(a, b) {
                return a === b;
            });

            this.locationFormTemplate = Handlebars.compile(document.querySelector("#location-form-template").innerHTML);
            this.locationModal = new bootstrap.Modal(document.getElementById('locationModal'));
            this.groupModal = new bootstrap.Modal(document.getElementById('groupModal'));

            this.setupEventListeners();
        },

        setupEventListeners() {
            // Add location mode toggle
            document.getElementById('add-location-mode').addEventListener('click', function() {
                MapApp.State.addLocationMode = !MapApp.State.addLocationMode;
                this.classList.toggle('active');
                MapApp.Map.leafletMap.getContainer().style.cursor = MapApp.State.addLocationMode ? 'crosshair' : '';
            });

            // Toggle sidebar button
            document.getElementById('toggle-sidebar').addEventListener('click', function() {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.toggle('hidden');
                // Icon swaps via CSS (#sidebar.hidden ~ #toggle-sidebar)
                this.setAttribute('aria-expanded', String(!sidebar.classList.contains('hidden')));
            });

            // Tab switching logic
            document.querySelectorAll('.tab-nav-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Remove active class from all buttons and panes
                    document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));

                    // Add active class to clicked button and target pane
                    btn.classList.add('active');
                    const target = btn.getAttribute('data-target');
                    const targetPane = document.querySelector(target);
                    if (targetPane) {
                        targetPane.classList.add('active');
                    }
                });
            });

            // Sidebar refresh button
            document.getElementById('refresh-data').addEventListener('click', () => {
                MapApp.Service.fetchLocationGroups();
            });

            // Save location button in modal
            document.getElementById('saveLocationBtn').addEventListener('click', () => {
                const form = document.getElementById('location-form');
                const formData = new FormData(form);
                const data = Object.fromEntries(formData.entries());
                
                if (data.rating) {
                    data.rating = parseInt(data.rating, 10);
                }

                if (!data.group) {
                    alert('Please select a group');
                    return;
                }

                MapApp.Service.saveLocation(data);
            });

            // Save group button in modal
            document.getElementById('saveGroupBtn').addEventListener('click', () => {
                const form = document.getElementById('group-form');
                const formData = new FormData(form);
                const data = {
                    name: formData.get('name'),
                    description: formData.get('description'),
                    is_public: formData.get('is_public') === 'on'
                };

                MapApp.Service.saveGroup(data);
            });

            // Add group button trigger modal
            document.getElementById('add-group').addEventListener('click', () => {
                document.getElementById('group-form').reset();
                this.groupModal.show();
            });

            // Search autocomplete events
            this.setupSearchAutocomplete();

            // Heatmap events
            this.setupHeatmapEvents();

            // Option: show location lists checkbox
            document.getElementById('show-location-lists').addEventListener('change', () => {
                Object.keys(MapApp.State.groupLayers).forEach(groupId => {
                    if (MapApp.State.groupLayers[groupId]) {
                        MapApp.Service.fetchLocationsForGroup(groupId);
                    }
                });
            });

            // View photos bound click
            document.getElementById('view-photos').addEventListener('click', () => {
                const bounds = MapApp.Map.leafletMap.getBounds();
                const n = bounds._northEast.lat.toFixed(5);
                const s = bounds._southWest.lat.toFixed(5);
                const e = bounds._northEast.lng.toFixed(5);
                const w = bounds._southWest.lng.toFixed(5);
                const b64 = btoa(`${n},${s},${e},${w}`);
                window.open(`/photos/?bounds=${b64}`, '_blank');
            });
        },

        setupSearchAutocomplete() {
            let searchTimeout;
            const searchInput = document.getElementById('location-search');
            const searchResults = document.getElementById('search-results');

            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                const query = e.target.value.trim();
                
                if (query.length < 3) {
                    searchResults.classList.add('hidden');
                    return;
                }
                
                searchTimeout = setTimeout(async () => {
                    const results = await MapApp.Service.searchLocation(query);
                    this.renderSearchResults(results, searchInput, searchResults);
                }, 500);
            });

            // Close dropdown clicking outside
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.classList.add('hidden');
                }
            });
        },

        renderSearchResults(results, searchInput, searchResults) {
            searchResults.innerHTML = '';
            if (results.length === 0) {
                searchResults.classList.add('hidden');
                return;
            }

            results.forEach(result => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.textContent = result.display_name;
                
                div.addEventListener('click', () => {
                    const location = {
                        id: '',
                        name: result.display_name.split(',')[0],
                        category: 'other',
                        description: '',
                        address: result.display_name,
                        rating: '',
                        latitude: parseFloat(result.lat),
                        longitude: parseFloat(result.lon),
                        group_id: ''
                    };
                    
                    MapApp.Map.leafletMap.setView([location.latitude, location.longitude], 16);
                    this.showLocationModal(location);
                    
                    searchInput.value = '';
                    searchResults.classList.add('hidden');
                });
                
                searchResults.appendChild(div);
            });
            
            searchResults.classList.remove('hidden');
        },

        setupHeatmapEvents() {
            // Slider value updates
            document.getElementById('year-filter').addEventListener('input', function() {
                document.getElementById('year-value').textContent = this.value;
            });

            document.getElementById('altitude-filter').addEventListener('input', function() {
                document.getElementById('altitude-value').textContent = 
                    this.value === "0" ? "No altitude data only" : `${this.value}m`;
            });

            // Reset filters to defaults
            document.getElementById('reset-filters').addEventListener('click', () => {
                const currentYear = new Date().getFullYear().toString();
                document.getElementById('year-filter').value = currentYear;
                document.getElementById('year-value').textContent = currentYear;
                document.getElementById('altitude-filter').value = "1000";
                document.getElementById('altitude-value').textContent = "1000m";
                document.getElementById('special-only').checked = false;
                document.getElementById('year-mode').checked = false;
                MapApp.Map.loadHeatmap(true);
            });

            // Load heatmap button
            document.getElementById('load-heatmap').addEventListener('click', () => {
                MapApp.Map.loadHeatmap(false);
            });
        },

        renderGroupsList(groups) {
            const sidebarContent = document.getElementById('sidebar-content');
            sidebarContent.innerHTML = '';

            groups.forEach(group => {
                const div = document.createElement('div');
                div.className = 'group-item';
                div.innerHTML = `
                    <div class="group-header">
                        <label class="group-toggle">
                            <input type="checkbox" class="form-check-input" data-group-id="${group.id}">
                            <strong>${esc(group.name)}</strong>
                        </label>
                        <span class="group-visibility" title="${group.is_public ? 'Public' : 'Private'}">${group.is_public ? svgIcon('globe2', 13) : svgIcon('lock-fill', 13)}</span>
                    </div>
                    <div class="group-locations" id="group-${group.id}">
                        <!-- Locations loaded inside -->
                    </div>
                `;

                // Checkbox toggle listener
                div.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    MapApp.Map.toggleGroupVisibility(group.id, isChecked);
                });

                sidebarContent.appendChild(div);
            });
        },

        renderGroupLocationsInSidebar(groupId, locations) {
            const groupDiv = document.getElementById(`group-${groupId}`);
            const showLists = document.getElementById('show-location-lists').checked;
            
            if (!showLists || !groupDiv) {
                if (groupDiv) groupDiv.innerHTML = '';
                return;
            }

            const icons = MapApp.Config.categoryIcons;
            groupDiv.innerHTML = locations.map(location => `
                <div class="location-marker">
                    <span class="location-icon">${icons[location.category] || icons['other']}</span>
                    <span class="location-name">${esc(location.name)}</span>
                    <span class="category-badge">${esc(location.category)}</span>
                    <div class="location-actions">
                        <button class="action-btn edit-location" title="Edit" aria-label="Edit" data-location-json='${encodeURIComponent(JSON.stringify(location))}'>${svgIcon('pencil', 13)}</button>
                        <button class="action-btn delete-location" title="Delete" aria-label="Delete" data-id="${location.id}">${svgIcon('trash3', 13)}</button>
                    </div>
                </div>
            `).join('');

            // Click bindings
            groupDiv.querySelectorAll('.edit-location').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const location = JSON.parse(decodeURIComponent(btn.dataset.locationJson));
                    this.showLocationModal(location);
                });
            });

            groupDiv.querySelectorAll('.delete-location').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete this location?')) {
                        MapApp.Service.deleteLocation(btn.dataset.id, groupId);
                    }
                });
            });
        },

        showLocationModal(location = null) {
            const modalTitle = document.getElementById('locationModalTitle');
            const modalBody = document.getElementById('locationModalBody');
            
            modalTitle.textContent = location && location.id ? 'Edit place' : 'New place';
            
            const templateData = location || {
                id: '',
                name: '',
                category: 'other',
                description: '',
                address: '',
                rating: '',
                latitude: MapApp.Map.leafletMap.getCenter().lat,
                longitude: MapApp.Map.leafletMap.getCenter().lng,
                group_id: ''
            };
            
            templateData.ratings = [1, 2, 3, 4, 5];
            templateData.groups = MapApp.State.locationGroups;
            
            modalBody.innerHTML = this.locationFormTemplate(templateData);
            this.locationModal.show();
        },

        closeLocationModal() {
            this.locationModal.hide();
        },

        closeGroupModal() {
            this.groupModal.hide();
        }
    }
};

// Initialise App on Page Load
document.addEventListener('DOMContentLoaded', () => {
    MapApp.Map.init();
    MapApp.UI.init();
    MapApp.Service.fetchLocationGroups();
});
