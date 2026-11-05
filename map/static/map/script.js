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
,
    "x-lg": '<path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>',
    "copy": '<path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>',
    "download": '<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/>',
    "cursor-fill": '<path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"/>',
    "map": '<path fill-rule="evenodd" d="M15.817.113A.5.5 0 0 1 16 .5v14a.5.5 0 0 1-.402.49l-5 1a.5.5 0 0 1-.196 0L5.5 15.01l-4.902.98A.5.5 0 0 1 0 15.5v-14a.5.5 0 0 1 .402-.49l5-1a.5.5 0 0 1 .196 0L10.5.99l4.902-.98a.5.5 0 0 1 .415.103M10 1.91l-4-.8v12.98l4 .8zm1 12.98 4-.8V1.11l-4 .8zm-6-.8V1.11l-4 .8v12.98z"/>',
    "star-fill": '<path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>',
    "check": '<path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>',
    "image": '<path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/>',
    "geo-alt-fill": '<path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6"/>',
    "plus": '<path fill-rule="evenodd" d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2"/>'
};

/* Places map. Everything user-provided is put on the page with textContent / attributes
 * (the h() helper below); innerHTML only ever receives the static icon markup above. */

const CFG = JSON.parse(document.getElementById('map-config').textContent);
const API = '/api/v2/places';
const STATUS_KEYS = CFG.statuses.map(s => s.key);
const STATUS_LABEL = Object.fromEntries(CFG.statuses.map(s => [s.key, s.label]));
const CATEGORY_LABEL = Object.fromEntries(CFG.categories.map(c => [c.key, c.label]));
const CATEGORY_ICON = {
    house: 'house-fill', business: 'building-fill', school: 'backpack-fill', university: 'mortarboard-fill',
    restaurant: 'cup-hot-fill', shop: 'shop', mall: 'bag-fill', parking: 'p-square-fill', religious: 'bank2',
    hospital: 'hospital-fill', transit: 'train-front-fill', park: 'tree-fill', nature: 'image-alt', other: 'dot',
};
const PIN_PATH = 'M14 1C6.8 1 1 6.7 1 13.7 1 23.2 14 35 14 35s13-11.8 13-21.3C27 6.7 21.2 1 14 1z';
const PHOTO_RADIUS_M = 150;
const DEFAULT_CENTER = [43.4643, -80.5204];  // Waterloo, when location isn't available

// ---------- small helpers ----------

// Inline SVG icon markup (static, trusted strings only)
function svgIcon(name, size = 16) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.dot}</svg>`;
}

function icon(name, size = 16) {
    const t = document.createElement('template');
    t.innerHTML = svgIcon(name, size);
    return t.content.firstChild;
}

// Build an element: h('a', {class: 'x', href, text}, ...children). Strings become text nodes.
function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    }
    return el;
}

const $ = sel => document.querySelector(sel);
const safeStatus = s => (STATUS_KEYS.includes(s) ? s : 'saved');
const categoryIcon = c => CATEGORY_ICON[c] || 'dot';
const categoryLabel = c => CATEGORY_LABEL[c] || 'Other';

const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ } },
};

function fmtDate(iso) {
    if (!iso) return '';
    const str = String(iso);
    const [y, m, d] = str.slice(0, 10).split('-').map(Number);
    // dates ("2026-08-03") are calendar days; timestamps are shown in local time
    const date = str.length > 10 ? new Date(str) : new Date(y, m - 1, d);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function distanceM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, x)));
}

function fmtDistance(m) {
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    return m < 100000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`;
}

const fmtCoords = (lat, lng) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;
const isPhone = () => window.matchMedia('(max-width: 575.98px)').matches;

async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-CSRFToken': CFG.csrf } };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    } else if (form) {
        opts.body = form;
    }
    const res = await fetch(API + path, opts);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        let msg = `Something went wrong (${res.status})`;
        if (data && typeof data.detail === 'string') msg = data.detail;
        else if (data && Array.isArray(data.detail)) msg = data.detail.map(e => `${(e.loc || []).slice(-1)[0]}: ${e.msg}`).join('; ');
        throw new Error(msg);
    }
    return data;
}

let toastTimer;
function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function copyText(text) {
    const done = () => toast('Copied to clipboard');
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, () => toast('Copy failed'));
        return;
    }
    const input = h('textarea', { class: 'visually-hidden' });
    input.value = text;
    document.body.append(input);
    input.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
    input.remove();
}

function photosLink(lat, lng, radiusM) {
    const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
    const b = [lat + dLat, lat - dLat, lng + dLng, lng - dLng].map(v => v.toFixed(5)).join(',');
    return `/photos/?bounds=${encodeURIComponent(btoa(b))}`;
}

// ---------- state ----------

const State = {
    groups: [],
    places: [],
    byId: new Map(),
    hiddenGroups: new Set(store.get('places.hiddenGroups', [])),
    filters: { q: '', status: '', category: '', minRating: 0 },
    userPos: null,
    selected: null,            // {type: 'place', id} | {type: 'suggestion', s}
    suggestions: [],
    dismissed: new Set(store.get('places.dismissedSpots', [])),
    statsStale: true,
    addMode: false,
    currentHeatmap: null,
    heatmapAbortController: null,
};

const ownGroups = () => State.groups.filter(g => g.mine);
const groupById = id => State.groups.find(g => g.id === id);
const isMine = place => !!(groupById(place.group_id) || {}).mine;
const spotKey = s => `${s.latitude.toFixed(3)},${s.longitude.toFixed(3)}`;

// ---------- map ----------

const MapView = {
    init() {
        this.map = L.map('mapid', { zoomControl: true }).setView(DEFAULT_CENTER, 3);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(this.map);

        this.markers = new Map();
        this.cluster = L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 44,
            disableClusteringAtZoom: 16,
            spiderfyOnMaxZoom: true,
            chunkedLoading: true,
            iconCreateFunction: c => L.divIcon({
                html: `<div class="place-cluster"><span>${Number(c.getChildCount())}</span></div>`,
                className: 'custom-div-icon',
                iconSize: L.point(36, 36),
            }),
        }).addTo(this.map);
        this.ghosts = L.layerGroup();

        this.map.on('click', e => {
            if (State.addMode) {
                UI.setAddMode(false);
                UI.openPlaceForm({ latitude: e.latlng.lat, longitude: e.latlng.lng });
            } else if (State.selected) {
                Sheet.close();
            }
        });
        this.addLegend();
        this.locateUser();
    },

    locateUser() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(pos => {
            State.userPos = [pos.coords.latitude, pos.coords.longitude];
            if (!new URLSearchParams(location.search).get('place')) this.map.setView(State.userPos, 13);
            L.marker(State.userPos, {
                icon: L.divIcon({ html: '<div class="user-location-dot"></div>', className: 'custom-div-icon', iconSize: [18, 18], iconAnchor: [9, 9] }),
                title: 'Your location', keyboard: false, interactive: false,
            }).addTo(this.map);
            UI.renderPlaceList();
            Sheet.refreshDistance();
        }, () => { /* permission denied: no distances */ }, { maximumAge: 300000, timeout: 10000 });
    },

    pinIcon(place, selected) {
        const status = safeStatus(place.status);
        const badge = status === 'visited' ? `<span class="map-pin-badge">${svgIcon('check', 9)}</span>` : '';
        return L.divIcon({
            html: `<div class="map-pin st-${status}${selected ? ' is-selected' : ''}"><svg class="map-pin-shape" viewBox="0 0 28 36" aria-hidden="true"><path d="${PIN_PATH}"/></svg><span class="map-pin-glyph">${svgIcon(categoryIcon(place.category), 14)}</span>${badge}</div>`,
            className: 'custom-div-icon',
            iconSize: [28, 36],
            iconAnchor: [14, 35],
        });
    },

    renderPlaces(list) {
        this.cluster.clearLayers();
        this.markers.clear();
        const selectedId = State.selected && State.selected.type === 'place' ? State.selected.id : null;
        const markers = list.map(p => {
            const m = L.marker([p.latitude, p.longitude], {
                icon: this.pinIcon(p, p.id === selectedId),
                title: `${p.name} (${STATUS_LABEL[safeStatus(p.status)]})`,
                alt: p.name,
                riseOnHover: true,
            });
            m.on('click', () => Sheet.openPlace(p.id, { fly: false }));
            m.on('keypress', e => { if (e.originalEvent.key === 'Enter') Sheet.openPlace(p.id, { fly: false }); });
            this.markers.set(p.id, m);
            return m;
        });
        this.cluster.addLayers(markers);
    },

    setSelected(prevId, nextId) {
        for (const id of [prevId, nextId]) {
            const m = id && this.markers.get(id);
            const p = id && State.byId.get(id);
            if (m && p) m.setIcon(this.pinIcon(p, id === nextId));
        }
    },

    renderGhosts(list) {
        this.ghosts.clearLayers();
        list.forEach(s => {
            const m = L.marker([s.latitude, s.longitude], {
                icon: L.divIcon({
                    html: `<div class="ghost-pin"><span>${Number(s.photos) > 99 ? '99+' : Number(s.photos)}</span></div>`,
                    className: 'custom-div-icon', iconSize: [30, 30], iconAnchor: [15, 15],
                }),
                title: `Suggested: ${s.address || s.name} (${s.photos} photos)`,
            });
            m.on('click', () => Sheet.openSuggestion(s, { fly: false }));
            this.ghosts.addLayer(m);
        });
    },

    showGhosts(show) {
        if (show) this.ghosts.addTo(this.map); else this.ghosts.remove();
        this.legendGhostRow.hidden = !show;
    },

    addLegend() {
        const Legend = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd: () => {
                const pin = st => {
                    const el = h('span', { class: `legend-pin st-${st}`, 'aria-hidden': 'true' });
                    el.innerHTML = `<svg viewBox="0 0 28 36"><path d="${PIN_PATH}"/></svg>${st === 'visited' ? `<span class="legend-badge">${svgIcon('check', 7)}</span>` : ''}`;
                    return el;
                };
                this.legendGhostRow = h('li', { hidden: true }, h('span', { class: 'legend-ghost', 'aria-hidden': 'true' }), 'Suggested');
                const box = h('div', { class: 'map-legend', role: 'group', 'aria-label': 'Map legend' },
                    h('ul', null,
                        STATUS_KEYS.map(st => h('li', null, pin(st), STATUS_LABEL[st])),
                        this.legendGhostRow));
                L.DomEvent.disableClickPropagation(box);
                return box;
            },
        });
        new Legend().addTo(this.map);
    },

    // Fit places into the part of the map not covered by the panels
    fitPlaces(list, maxZoom = 13) {
        if (!list.length) return;
        const sidebar = $('#sidebar');
        const open = !sidebar.classList.contains('hidden');
        const phone = isPhone();
        this.map.fitBounds(L.latLngBounds(list.map(p => [p.latitude, p.longitude])), {
            maxZoom,
            paddingTopLeft: [!phone && open ? sidebar.offsetWidth + 40 : 30, $('.map-topbar').getBoundingClientRect().bottom + 24],
            paddingBottomRight: [40, phone && open ? sidebar.offsetHeight + 30 : 40],
        });
    },

    // Centre a point in the part of the map not covered by the panels
    focus(lat, lng, minZoom = 16) {
        const map = this.map;
        const zoom = Math.max(map.getZoom(), minZoom);
        const top = $('.map-topbar').getBoundingClientRect().bottom + 8;
        let left = 0, right = 0, bottom = 0;
        const sidebar = $('#sidebar'), sheet = $('#place-sheet');
        if (isPhone()) {
            bottom = !sheet.hidden ? sheet.offsetHeight : (!sidebar.classList.contains('hidden') ? sidebar.offsetHeight : 0);
        } else {
            if (!sidebar.classList.contains('hidden')) left = sidebar.offsetWidth + 16;
            if (!sheet.hidden) right = sheet.offsetWidth + 16;
        }
        const point = map.project([lat, lng], zoom).subtract([(left - right) / 2, (top - bottom) / 2]);
        map.setView(map.unproject(point, zoom), zoom, { animate: true });
    },

    // ---- photo heatmap (unchanged behaviour) ----
    loadHeatmap(useDefaults = true) {
        if (State.heatmapAbortController) State.heatmapAbortController.abort();
        State.heatmapAbortController = new AbortController();
        if (State.currentHeatmap) {
            this.map.removeLayer(State.currentHeatmap);
            State.currentHeatmap = null;
        }
        const params = new URLSearchParams();
        params.append('vals', '1');
        if (useDefaults) {
            params.append('alt-', '1000');
        } else {
            const year = $('#year-filter').value;
            params.append($('#year-mode').checked ? 'year' : 'year-', year);
            const alt = $('#altitude-filter').value;
            params.append('alt-', alt === '0' ? 'NIL' : alt);
            if ($('#special-only').checked) params.append('special', '1');
        }
        fetch(`/photos/map/?${params.toString()}`, { signal: State.heatmapAbortController.signal })
            .then(r => r.json())
            .then(data => {
                const points = data.coords.filter(c => c[0] !== 0 && c[1] !== 0).map(c => [c[0], c[1], 1]);
                if (State.currentHeatmap) this.map.removeLayer(State.currentHeatmap);
                // ?style=dot restores the original per-photo dot heatmap (heatmap.js); otherwise the blurred heatmap
                if (new URLSearchParams(location.search).get('style') === 'dot') {
                    const layer = new HeatmapOverlay({
                        radius: 7, maxOpacity: 0.9, scaleRadius: false, useLocalExtrema: true,
                        latField: 'lat', lngField: 'lng', valueField: 'count',
                    });
                    layer.addTo(this.map);
                    layer.setData({ max: 1, data: points.map(p => ({ lat: p[0], lng: p[1], count: p[2] })) });
                    State.currentHeatmap = layer;
                } else {
                    State.currentHeatmap = L.heatLayer(points, { minOpacity: 0.3, radius: 25, blur: 20, max: 1 }).addTo(this.map);
                }
            })
            .catch(err => { if (err.name !== 'AbortError') toast('Could not load the heatmap'); });
    },
};

// ---------- data ----------

const Data = {
    async load() {
        try {
            const [groups, places] = await Promise.all([api('/groups'), api('/')]);
            State.groups = groups;
            State.places = places;
            State.byId = new Map(places.map(p => [p.id, p]));
            State.statsStale = true;
            UI.renderGroups();
            UI.applyFilters();
            if (State.selected && State.selected.type === 'place') {
                if (State.byId.has(State.selected.id)) Sheet.renderPlace(State.byId.get(State.selected.id), false);
                else Sheet.close();
            }
        } catch (e) {
            $('#group-list').replaceChildren(h('p', { class: 'empty-line', text: 'Could not load your places. ' + e.message }));
        }
    },

    async loadSuggestions() {
        try {
            const list = await api('/suggestions?limit=30');
            State.suggestions = list.filter(s => !State.dismissed.has(spotKey(s)));
        } catch (e) {
            State.suggestions = [];
        }
        Suggestions.render();
    },
};

// ---------- panel: groups, filters, list ----------

const UI = {
    init() {
        this.placeModal = new bootstrap.Modal($('#locationModal'));
        this.groupModal = new bootstrap.Modal($('#groupModal'));
        this.importModal = new bootstrap.Modal($('#importModal'));

        // Category and status options from the server config
        $('#category-filter').append(...CFG.categories.map(c => h('option', { value: c.key, text: c.label })));
        $('#loc-category').append(...CFG.categories.map(c => h('option', { value: c.key, text: c.label })));
        $('#loc-status').append(...CFG.statuses.map(s => h('option', { value: s.key, text: s.label })));

        $('#theme-btn').addEventListener('click', () => window.cycleTheme && window.cycleTheme());
        $('#add-location-mode').addEventListener('click', () => this.setAddMode(!State.addMode));
        $('#toggle-sidebar').addEventListener('click', e => {
            const sidebar = $('#sidebar');
            sidebar.classList.toggle('hidden');
            e.currentTarget.setAttribute('aria-expanded', String(!sidebar.classList.contains('hidden')));
        });
        document.querySelectorAll('.tab-nav-btn').forEach(btn => btn.addEventListener('click', () => this.showTab(btn)));
        $('#refresh-data').addEventListener('click', () => { Data.load(); Data.loadSuggestions(); });
        $('#add-group').addEventListener('click', () => this.openGroupForm());
        $('#saveGroupBtn').addEventListener('click', () => this.saveGroup());
        $('#saveLocationBtn').addEventListener('click', () => this.savePlace());
        $('#loc-status').addEventListener('change', () => this.syncVisitedField());
        $('#location-form').addEventListener('submit', e => { e.preventDefault(); this.savePlace(); });
        $('#group-form').addEventListener('submit', e => { e.preventDefault(); this.saveGroup(); });

        // Filters
        let filterTimer;
        $('#place-filter').addEventListener('input', e => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => { State.filters.q = e.target.value.trim().toLowerCase(); this.applyFilters(); }, 120);
        });
        $('#status-chips').addEventListener('click', e => {
            const chip = e.target.closest('.chip');
            if (!chip) return;
            State.filters.status = chip.dataset.status;
            this.applyFilters();
        });
        $('#category-filter').addEventListener('change', e => { State.filters.category = e.target.value; this.applyFilters(); });
        $('#rating-filter').addEventListener('change', e => { State.filters.minRating = Number(e.target.value) || 0; this.applyFilters(); });
        $('#clear-filters').addEventListener('click', () => {
            State.filters = { q: '', status: '', category: '', minRating: 0 };
            $('#place-filter').value = '';
            $('#category-filter').value = '';
            $('#rating-filter').value = '';
            this.applyFilters();
        });

        $('#view-photos').addEventListener('click', () => {
            const b = MapView.map.getBounds();
            const v = [b.getNorth(), b.getSouth(), b.getEast(), b.getWest()].map(x => x.toFixed(5)).join(',');
            window.open(`/photos/?bounds=${encodeURIComponent(btoa(v))}`, '_blank', 'noopener');
        });

        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || document.querySelector('.modal.show')) return;
            if (State.addMode) this.setAddMode(false);
            else if (State.selected) Sheet.close();
        });

        Search.init();
        Import.init();
        this.initHeatmap();
    },

    setAddMode(on) {
        State.addMode = on;
        const btn = $('#add-location-mode');
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
        MapView.map.getContainer().style.cursor = on ? 'crosshair' : '';
        if (on) toast('Click on the map to place the pin');
    },

    showTab(btn) {
        document.querySelectorAll('.tab-nav-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const target = btn.dataset.target;
        $(target).classList.add('active');
        MapView.showGhosts(target === '#pane-suggested');
        if (target === '#pane-stats' && State.statsStale) Stats.load();
    },

    renderGroups() {
        const list = $('#group-list');
        if (!State.groups.length) {
            list.replaceChildren(h('p', { class: 'empty-line', text: 'No groups yet. Use + to create one.' }));
            return;
        }
        list.replaceChildren(...State.groups.map(g => {
            const checkbox = h('input', { type: 'checkbox', class: 'form-check-input', 'aria-label': `Show ${g.name} on the map` });
            checkbox.checked = !State.hiddenGroups.has(g.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) State.hiddenGroups.delete(g.id); else State.hiddenGroups.add(g.id);
                store.set('places.hiddenGroups', [...State.hiddenGroups]);
                this.applyFilters();
            });
            const vis = h('span', { class: 'group-visibility', title: g.is_public ? (g.mine ? 'Public' : 'Public, shared with you (read-only)') : 'Private' });
            vis.append(icon(g.is_public ? 'globe2' : 'lock-fill', 12));
            const exportLink = h('a', {
                class: 'icon-btn icon-btn-sm group-export', href: `${API}/groups/${Number(g.id)}/export`, download: '',
                title: `Export ${g.name} as GeoJSON`, 'aria-label': `Export ${g.name} as GeoJSON`,
            });
            exportLink.append(icon('download', 13));
            return h('div', { class: 'group-header' },
                h('label', { class: 'group-toggle' }, checkbox, h('strong', { text: g.name })),
                h('span', { class: 'group-count', text: String(g.count) }),
                vis, exportLink);
        }));
    },

    filteredPlaces() {
        const f = State.filters;
        return State.places.filter(p =>
            !State.hiddenGroups.has(p.group_id)
            && (!f.status || p.status === f.status)
            && (!f.category || p.category === f.category)
            && (!f.minRating || (p.rating || 0) >= f.minRating)
            && (!f.q || [p.name, p.address, p.notes, p.description].some(v => v && v.toLowerCase().includes(f.q))));
    },

    applyFilters() {
        const f = State.filters;
        const inGroups = State.places.filter(p => !State.hiddenGroups.has(p.group_id));
        document.querySelectorAll('#status-chips .chip').forEach(chip => {
            const st = chip.dataset.status;
            chip.setAttribute('aria-pressed', String(st === f.status));
            if (!st) return;  // "All": the total is in the list header
            const n = inGroups.filter(p => p.status === st).length;
            let count = chip.querySelector('.chip-count');
            if (!count) { count = h('span', { class: 'chip-count' }); chip.append(count); }
            count.textContent = String(n);
        });
        $('#clear-filters').hidden = !(f.q || f.status || f.category || f.minRating);
        this.filtered = this.filteredPlaces();
        MapView.renderPlaces(this.filtered);
        this.renderPlaceList();
    },

    renderPlaceList() {
        const list = $('#place-list');
        const items = (this.filtered || []).slice();
        const pos = State.userPos;
        if (pos) items.sort((a, b) => distanceM(pos, [a.latitude, a.longitude]) - distanceM(pos, [b.latitude, b.longitude]));
        $('#places-count').textContent = items.length === State.places.length
            ? plural(items.length, 'place') + (pos ? ' · nearest first' : '')
            : `${items.length} of ${plural(State.places.length, 'place')}`;
        if (!items.length) {
            list.replaceChildren(h('li', { class: 'empty-line', text: State.places.length ? 'No places match these filters.' : 'No places yet. Use Add place, search, or import a file.' }));
            return;
        }
        const selectedId = State.selected && State.selected.type === 'place' ? State.selected.id : null;
        list.replaceChildren(...items.slice(0, 500).map(p => {
            const status = safeStatus(p.status);
            const mark = h('span', { class: `place-mark st-${status}`, title: STATUS_LABEL[status] });
            mark.append(icon(categoryIcon(p.category), 12));
            const sub = [categoryLabel(p.category)];
            if (p.rating) sub.push(`${p.rating}★`);
            const group = groupById(p.group_id);
            if (group && State.groups.length > 1) sub.push(group.name);
            const row = h('button', {
                type: 'button', class: 'place-row' + (p.id === selectedId ? ' is-selected' : ''),
                'aria-label': `${p.name}, ${STATUS_LABEL[status]}`,
                onclick: () => Sheet.openPlace(p.id),
            },
            mark,
            h('span', { class: 'place-main' },
                h('span', { class: 'place-name', text: p.name }),
                h('span', { class: 'place-sub', text: sub.join(' · ') })),
            pos ? h('span', { class: 'place-dist', text: fmtDistance(distanceM(pos, [p.latitude, p.longitude])) }) : null);
            return h('li', null, row);
        }));
    },

    // ---- place form ----
    openPlaceForm(place = {}) {
        const groups = ownGroups();
        if (!groups.length) {
            toast('Create a group first');
            this.openGroupForm();
            return;
        }
        $('#locationModalTitle').textContent = place.id ? 'Edit place' : 'New place';
        const groupSelect = $('#loc-group');
        groupSelect.replaceChildren(...groups.map(g => h('option', { value: String(g.id), text: g.name })));
        const preferred = place.group_id || store.get('places.lastGroup', null);
        groupSelect.value = groups.some(g => g.id === preferred) ? String(preferred) : String(groups[0].id);
        $('#loc-id').value = place.id || '';
        $('#loc-lat').value = place.latitude;
        $('#loc-lng').value = place.longitude;
        $('#loc-name').value = place.name || '';
        $('#loc-category').value = place.category || 'other';
        $('#loc-status').value = safeStatus(place.status);
        $('#loc-visited').value = place.visited_on || '';
        $('#loc-rating').value = String(place.rating || 0);
        $('#loc-address').value = place.address || '';
        $('#loc-description').value = place.description || '';
        $('#loc-notes').value = place.notes || '';
        $('#loc-error').hidden = true;
        this.syncVisitedField();
        this.placeModal.show();
        $('#locationModal').addEventListener('shown.bs.modal', () => $('#loc-name').focus(), { once: true });
    },

    syncVisitedField() {
        $('#loc-visited').closest('.col-sm-6').hidden = $('#loc-status').value !== 'visited';
    },

    async savePlace() {
        const id = $('#loc-id').value;
        const name = $('#loc-name').value.trim();
        const err = $('#loc-error');
        if (!name) { err.textContent = 'Give the place a name.'; err.hidden = false; return; }
        const status = $('#loc-status').value;
        const rating = Number($('#loc-rating').value) || 0;
        const body = {
            group_id: Number($('#loc-group').value),
            name,
            latitude: Number($('#loc-lat').value),
            longitude: Number($('#loc-lng').value),
            category: $('#loc-category').value,
            status,
            rating: id ? rating : (rating || null),
            address: $('#loc-address').value.trim(),
            description: $('#loc-description').value.trim(),
            notes: $('#loc-notes').value.trim(),
        };
        const visited = $('#loc-visited').value;
        if (status === 'visited') { if (visited) body.visited_on = visited; } else body.visited_on = null;
        const btn = $('#saveLocationBtn');
        btn.disabled = true;
        try {
            const saved = await api(id ? `/${encodeURIComponent(id)}` : '/', { method: id ? 'PATCH' : 'POST', body });
            store.set('places.lastGroup', body.group_id);
            State.hiddenGroups.delete(body.group_id);
            this.placeModal.hide();
            await Data.load();
            toast(id ? 'Place updated' : 'Place saved');
            if (!id) Data.loadSuggestions();
            Sheet.openPlace(saved.id);
        } catch (e) {
            err.textContent = e.message;
            err.hidden = false;
        } finally {
            btn.disabled = false;
        }
    },

    async setStatus(place, status) {
        try {
            await api(`/${encodeURIComponent(place.id)}`, { method: 'PATCH', body: { status } });
            await Data.load();
            toast(`Marked as ${STATUS_LABEL[status].toLowerCase()}`);
        } catch (e) {
            toast(e.message);
        }
    },

    async deletePlace(place) {
        if (!confirm(`Delete "${place.name}"? This can't be undone.`)) return;
        try {
            await api(`/${encodeURIComponent(place.id)}`, { method: 'DELETE' });
            Sheet.close();
            await Data.load();
            Data.loadSuggestions();
            toast('Place deleted');
        } catch (e) {
            toast(e.message);
        }
    },

    // ---- groups ----
    openGroupForm() {
        $('#group-form').reset();
        $('#group-error').hidden = true;
        this.groupModal.show();
        $('#groupModal').addEventListener('shown.bs.modal', () => $('#group-name').focus(), { once: true });
    },

    async saveGroup() {
        const name = $('#group-name').value.trim();
        const err = $('#group-error');
        if (!name) { err.textContent = 'Give the group a name.'; err.hidden = false; return; }
        try {
            const g = await api('/groups', { method: 'POST', body: { name, description: $('#group-description').value.trim(), is_public: $('#is_public').checked } });
            store.set('places.lastGroup', g.id);
            this.groupModal.hide();
            await Data.load();
            toast('Group created');
        } catch (e) {
            err.textContent = e.message;
            err.hidden = false;
        }
    },

    initHeatmap() {
        $('#year-filter').addEventListener('input', e => { $('#year-value').textContent = e.target.value; });
        $('#altitude-filter').addEventListener('input', e => {
            $('#altitude-value').textContent = e.target.value === '0' ? 'No altitude data only' : `${e.target.value}m`;
        });
        $('#reset-filters').addEventListener('click', () => {
            const year = String(new Date().getFullYear());
            $('#year-filter').value = year;
            $('#year-value').textContent = year;
            $('#altitude-filter').value = '1000';
            $('#altitude-value').textContent = '1000m';
            $('#special-only').checked = false;
            $('#year-mode').checked = false;
            MapView.loadHeatmap(true);
        });
        $('#load-heatmap').addEventListener('click', () => MapView.loadHeatmap(false));
    },
};

// ---------- detail sheet ----------

const Sheet = {
    el: null,
    photoToken: 0,

    init() {
        this.el = $('#place-sheet');
        const id = new URLSearchParams(location.search).get('place');
        if (id) this.pendingId = id;
    },

    afterLoad() {
        if (this.pendingId && State.byId.has(this.pendingId)) this.openPlace(this.pendingId);
        this.pendingId = null;
    },

    show() {
        this.el.hidden = false;
        document.body.classList.add('sheet-open');
    },

    close() {
        const prev = State.selected;
        State.selected = null;
        this.el.hidden = true;
        this.el.replaceChildren();
        document.body.classList.remove('sheet-open');
        if (prev && prev.type === 'place') {
            MapView.setSelected(prev.id, null);
            UI.renderPlaceList();
        }
        const url = new URL(location.href);
        if (url.searchParams.has('place')) { url.searchParams.delete('place'); history.replaceState(null, '', url); }
    },

    openPlace(id, { fly = true } = {}) {
        const place = State.byId.get(id);
        if (!place) return;
        const prev = State.selected && State.selected.type === 'place' ? State.selected.id : null;
        State.selected = { type: 'place', id };
        MapView.setSelected(prev, id);
        this.renderPlace(place, true);
        UI.renderPlaceList();
        const url = new URL(location.href);
        url.searchParams.set('place', id);
        history.replaceState(null, '', url);
        if (fly) {
            const marker = MapView.markers.get(id);
            if (marker) MapView.cluster.zoomToShowLayer(marker, () => MapView.focus(place.latitude, place.longitude));
            else MapView.focus(place.latitude, place.longitude);
        }
    },

    header(iconName, iconClass, title, sub) {
        const badge = h('span', { class: `sheet-icon ${iconClass}` });
        badge.append(icon(iconName, 16));
        const close = h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Close details', title: 'Close', onclick: () => this.close() });
        close.append(icon('x-lg', 14));
        return h('div', { class: 'sheet-head' }, badge,
            h('div', { class: 'sheet-titles' }, h('h2', { class: 'sheet-title', text: title }), h('div', { class: 'sheet-sub', text: sub })),
            close);
    },

    action(label, iconName, attrs) {
        const tag = attrs.href ? 'a' : 'button';
        const el = h(tag, { class: 'sheet-action' + (attrs.danger ? ' danger' : ''), ...(tag === 'button' ? { type: 'button' } : { target: '_blank', rel: 'noopener noreferrer' }), href: attrs.href, onclick: attrs.onclick });
        const circle = h('span', { class: 'sheet-action-icon' });
        circle.append(icon(iconName, 15));
        el.append(circle, h('span', { text: label }));
        return el;
    },

    links(lat, lng) {
        return [
            this.action('Directions', 'cursor-fill', { href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` }),
            this.action('OpenStreetMap', 'map', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` }),
        ];
    },

    coordsRow(lat, lng) {
        const text = fmtCoords(lat, lng);
        const btn = h('button', { type: 'button', class: 'icon-btn icon-btn-sm', title: 'Copy coordinates', 'aria-label': 'Copy coordinates', onclick: () => copyText(text) });
        btn.append(icon('copy', 13));
        return h('div', { class: 'sheet-row' }, h('span', { class: 'sheet-row-label', text: 'Coordinates' }),
            h('span', { class: 'sheet-coords' }, h('code', { text }), btn));
    },

    field(label, value) {
        return value ? h('div', { class: 'sheet-row sheet-row-block' }, h('span', { class: 'sheet-row-label', text: label }), h('p', { class: 'sheet-text', text: value })) : null;
    },

    distanceEl(lat, lng) {
        const el = h('span', { class: 'sheet-distance', 'data-lat': String(lat), 'data-lng': String(lng) });
        if (State.userPos) el.textContent = `${fmtDistance(distanceM(State.userPos, [lat, lng]))} away`;
        return el;
    },

    refreshDistance() {
        const el = this.el && this.el.querySelector('.sheet-distance');
        if (el && State.userPos) el.textContent = `${fmtDistance(distanceM(State.userPos, [Number(el.dataset.lat), Number(el.dataset.lng)]))} away`;
    },

    photosSection(path) {
        const strip = h('div', { class: 'photo-strip', 'aria-busy': 'true' },
            [0, 1, 2, 3].map(() => h('span', { class: 'photo-thumb skeleton-box' })));
        const summary = h('p', { class: 'photos-summary' }, h('span', { class: 'skeleton-box w-55 skeleton-inline' }));
        const section = h('section', { class: 'sheet-section', 'aria-label': 'Photos here' },
            h('div', { class: 'sheet-section-head' }, h('span', { class: 'panel-label', text: 'Photos here' }),
                h('span', { class: 'sheet-hint', text: `within ${PHOTO_RADIUS_M} m` })),
            summary, strip);
        const token = ++this.photoToken;
        api(path).then(data => {
            if (token !== this.photoToken) return;
            this.fillPhotos(data, summary, strip, path);
        }).catch(() => {
            if (token !== this.photoToken) return;
            summary.textContent = 'Photos could not be loaded.';
            strip.remove();
        });
        return section;
    },

    fillPhotos(data, summary, strip, path) {
        strip.removeAttribute('aria-busy');
        if (!data.count) {
            summary.textContent = 'None of your photos were taken here.';
            strip.remove();
            return;
        }
        const parts = [plural(data.visits, 'visit')];
        if (data.last_visit) parts.push(`last ${fmtDate(data.last_visit)}`);
        if (data.first_visit && data.visits > 1) parts.push(`first ${fmtDate(data.first_visit)}`);
        summary.textContent = parts.join(' · ');
        summary.title = 'Visits are days with your photos nearby';
        const thumbs = data.photos.map(p => {
            const img = h('img', { src: p.thumb_url, alt: p.date_taken ? `Photo from ${fmtDate(p.date_taken)}` : 'Photo', loading: 'lazy', decoding: 'async' });
            img.addEventListener('error', () => img.classList.add('broken'), { once: true });
            return h('a', { class: 'photo-thumb', href: `/photos/view-photo/${encodeURIComponent(p.id)}/`, title: p.date_taken ? fmtDate(p.date_taken) : '' }, img);
        });
        if (data.count > data.photos.length) {
            const params = new URLSearchParams(path.split('?')[1] || '');
            const sel = State.selected && State.selected.type === 'place' ? State.byId.get(State.selected.id) : null;
            const lat = sel ? sel.latitude : Number(params.get('latitude'));
            const lng = sel ? sel.longitude : Number(params.get('longitude'));
            thumbs.push(h('a', { class: 'photo-thumb photo-more', href: photosLink(lat, lng, PHOTO_RADIUS_M), target: '_blank', rel: 'noopener', text: `+${(data.count - data.photos.length).toLocaleString()}` }));
        }
        strip.replaceChildren(...thumbs);
        summary.after(h('p', { class: 'sheet-hint', text: plural(data.count, 'photo') }));
    },

    renderPlace(place, refetchPhotos) {
        const mine = isMine(place);
        const status = safeStatus(place.status);
        const group = groupById(place.group_id);
        const lat = place.latitude, lng = place.longitude;
        const keepPhotos = !refetchPhotos && this.el.querySelector('.sheet-section');

        const statusControl = mine
            ? h('div', { class: 'status-seg', role: 'group', 'aria-label': 'Status' }, STATUS_KEYS.map(st =>
                h('button', { type: 'button', class: `status-seg-btn st-${st}`, 'aria-pressed': String(st === status), onclick: () => st !== status && UI.setStatus(place, st) },
                    h('span', { class: `status-swatch s-${st}`, 'aria-hidden': 'true' }), STATUS_LABEL[st])))
            : h('div', { class: 'sheet-meta' }, h('span', { class: `status-swatch s-${status}`, 'aria-hidden': 'true' }), STATUS_LABEL[status]);

        const meta = h('div', { class: 'sheet-meta' });
        if (place.rating) {
            const stars = h('span', { class: 'sheet-stars', title: `${place.rating} out of 5`, 'aria-label': `Rated ${place.rating} out of 5` });
            for (let i = 1; i <= 5; i++) { const s = icon('star-fill', 12); if (i > place.rating) s.classList.add('off'); stars.append(s); }
            meta.append(stars);
        }
        if (status === 'visited' && place.visited_on) meta.append(h('span', { text: `Visited ${fmtDate(place.visited_on)}` }));
        meta.append(this.distanceEl(lat, lng));

        const actions = h('div', { class: 'sheet-actions' }, this.links(lat, lng),
            this.action('Copy', 'copy', { onclick: () => copyText(fmtCoords(lat, lng)) }),
            mine ? this.action('Edit', 'pencil', { onclick: () => UI.openPlaceForm(place) }) : null,
            mine ? this.action('Delete', 'trash3', { danger: true, onclick: () => UI.deletePlace(place) }) : null);

        const body = h('div', { class: 'sheet-body' },
            statusControl, meta, actions,
            h('div', { class: 'sheet-details' },
                this.field('Address', place.address),
                this.field('Description', place.description),
                this.field('Notes', place.notes),
                this.coordsRow(lat, lng)),
            keepPhotos || this.photosSection(`/${encodeURIComponent(place.id)}/photos`),
            h('p', { class: 'sheet-foot', text: [group ? (group.mine ? group.name : `${group.name} (shared, read-only)`) : '', place.updated_on ? `Updated ${fmtDate(place.updated_on)}` : ''].filter(Boolean).join(' · ') }));

        this.el.replaceChildren(
            this.header(categoryIcon(place.category), `st-${status}`, place.name, categoryLabel(place.category)),
            body);
        this.show();
    },

    openSuggestion(s, { fly = true } = {}) {
        const prev = State.selected && State.selected.type === 'place' ? State.selected.id : null;
        MapView.setSelected(prev, null);
        State.selected = { type: 'suggestion', s };
        const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => Suggestions.save(s) }, icon('plus', 14), ' Save place');
        const dismiss = h('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', text: 'Dismiss', onclick: () => Suggestions.dismiss(s) });
        const range = s.first_day && s.last_day && s.first_day !== s.last_day ? `${fmtDate(s.first_day)} – ${fmtDate(s.last_day)}` : fmtDate(s.last_day);
        const body = h('div', { class: 'sheet-body' },
            h('p', { class: 'sheet-lead', text: `${plural(s.photos, 'photo')} on ${plural(s.days, 'day')}${range ? ' · ' + range : ''}` }),
            h('div', { class: 'sheet-buttons' }, save, dismiss),
            h('div', { class: 'sheet-meta' }, this.distanceEl(s.latitude, s.longitude)),
            h('div', { class: 'sheet-actions' }, this.links(s.latitude, s.longitude),
                this.action('Copy', 'copy', { onclick: () => copyText(fmtCoords(s.latitude, s.longitude)) })),
            h('div', { class: 'sheet-details' }, this.coordsRow(s.latitude, s.longitude)),
            this.photosSection(`/photos-near?latitude=${s.latitude.toFixed(6)}&longitude=${s.longitude.toFixed(6)}`));
        this.el.replaceChildren(this.header('image', 'is-ghost', s.address || s.name, 'Suggested · frequent photo spot'), body);
        this.show();
        UI.renderPlaceList();
        if (fly) MapView.focus(s.latitude, s.longitude, 15);
    },
};

// ---------- suggestions ----------

const Suggestions = {
    render() {
        const list = State.suggestions;
        const count = $('#suggest-count');
        count.hidden = !list.length;
        count.textContent = String(list.length);
        MapView.renderGhosts(list);
        const box = $('#suggestion-list');
        if (!list.length) {
            box.replaceChildren(h('p', { class: 'empty-line', text: 'No suggestions right now. Spots you photograph on several days show up here.' }));
            return;
        }
        box.replaceChildren(h('ul', { class: 'place-list' }, list.map(s => {
            const mark = h('span', { class: 'place-mark is-ghost' });
            mark.append(icon('image', 12));
            const save = h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary suggest-save', 'aria-label': `Save ${s.address || s.name} as a place`, onclick: e => { e.stopPropagation(); this.save(s); } }, 'Save');
            return h('li', { class: 'suggest-item' },
                h('button', { type: 'button', class: 'place-row', onclick: () => Sheet.openSuggestion(s) },
                    mark,
                    h('span', { class: 'place-main' },
                        h('span', { class: 'place-name', text: s.address || s.name }),
                        h('span', { class: 'place-sub', text: `${plural(s.photos, 'photo')} · ${plural(s.days, 'day')}${s.last_day ? ' · last ' + fmtDate(s.last_day) : ''}` }))),
                save);
        })));
    },

    save(s) {
        UI.openPlaceForm({
            name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude,
            category: 'other', status: 'visited', visited_on: s.last_day,
        });
    },

    dismiss(s) {
        State.dismissed.add(spotKey(s));
        store.set('places.dismissedSpots', [...State.dismissed].slice(-200));
        State.suggestions = State.suggestions.filter(x => x !== s);
        this.render();
        Sheet.close();
        toast('Suggestion dismissed');
    },
};

// ---------- stats ----------

const Stats = {
    async load() {
        const box = $('#stats-body');
        try {
            const data = await api('/stats');
            State.statsStale = false;
            this.render(box, data);
        } catch (e) {
            box.replaceChildren(h('p', { class: 'empty-line', text: 'Stats could not be loaded.' }));
        }
    },

    render(box, d) {
        const tiles = h('div', { class: 'stat-tiles' },
            [['Places', d.total], ['Visited', d.by_status.visited], ['Want to go', d.by_status.want_to_go]].map(([label, n]) =>
                h('div', { class: 'stat-tile' }, h('span', { class: 'stat-value', text: n.toLocaleString() }), h('span', { class: 'stat-label', text: label }))));

        // Status split: one stacked bar plus a labelled legend (identity never colour-only)
        const bar = h('div', { class: 'stack-bar', role: 'img', 'aria-label': STATUS_KEYS.map(st => `${STATUS_LABEL[st]} ${d.by_status[st]}`).join(', ') });
        STATUS_KEYS.forEach(st => {
            if (d.by_status[st]) {
                const seg = h('span', { class: `stack-seg s-${st}`, title: `${STATUS_LABEL[st]}: ${d.by_status[st]}` });
                seg.style.flexGrow = String(d.by_status[st]);
                bar.append(seg);
            }
        });
        const legend = h('ul', { class: 'stack-legend' }, STATUS_KEYS.map(st =>
            h('li', null, h('span', { class: `status-swatch s-${st}`, 'aria-hidden': 'true' }), STATUS_LABEL[st], h('span', { class: 'stack-n', text: String(d.by_status[st]) }))));

        const max = Math.max(1, ...d.by_category.map(c => c.count));
        const cats = h('ul', { class: 'bar-list' }, d.by_category.map(c => {
            const fill = h('span', { class: 'bar-fill' });
            fill.style.width = `${(c.count / max) * 100}%`;
            const ico = h('span', { class: 'bar-icon' });
            ico.append(icon(categoryIcon(c.key), 12));
            return h('li', { title: `${c.label}: ${c.count}` }, ico, h('span', { class: 'bar-label', text: c.label }),
                h('span', { class: 'bar-track' }, fill), h('span', { class: 'bar-n', text: String(c.count) }));
        }));

        const visited = d.most_visited.length
            ? h('ul', { class: 'place-list' }, d.most_visited.map((v, i) => h('li', null,
                h('button', { type: 'button', class: 'place-row', onclick: () => Sheet.openPlace(v.id) },
                    h('span', { class: 'rank', text: String(i + 1) }),
                    h('span', { class: 'place-main' }, h('span', { class: 'place-name', text: v.name }),
                        h('span', { class: 'place-sub', text: `${plural(v.visits, 'visit')}${v.last_visit ? ' · last ' + fmtDate(v.last_visit) : ''}` }))))))
            : h('p', { class: 'empty-line', text: 'No photos near your places yet.' });

        const section = (title, ...content) => h('section', { class: 'stats-section' }, h('h3', { class: 'panel-label', text: title }), ...content);
        box.replaceChildren(
            tiles,
            d.total ? section('By status', bar, legend) : null,
            d.by_category.length ? section('By category', cats) : null,
            section('Most visited', visited, h('p', { class: 'sheet-hint', text: `Visits are days with your photos within ${PHOTO_RADIUS_M} m.` })));
    },
};

// ---------- top search: your places first, then the map (Nominatim proxy, when online) ----------

const Search = {
    init() {
        this.input = $('#location-search');
        this.results = $('#search-results');
        this.active = -1;
        let localTimer, remoteTimer, seq = 0;
        this.input.addEventListener('input', () => {
            const q = this.input.value.trim();
            clearTimeout(localTimer);
            clearTimeout(remoteTimer);
            if (!q) { this.hide(); return; }
            localTimer = setTimeout(() => this.render(q, null), 80);
            if (CFG.online && q.length >= 3) {
                const mySeq = ++seq;
                remoteTimer = setTimeout(async () => {
                    let remote = [];
                    try {
                        const r = await fetch(`/map/nominatim/search/?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
                        if (r.ok) remote = await r.json();
                    } catch (e) { /* offline */ }
                    if (mySeq === seq && this.input.value.trim() === q) this.render(q, Array.isArray(remote) ? remote.slice(0, 6) : []);
                }, 450);
            }
        });
        this.input.addEventListener('keydown', e => this.onKey(e));
        document.addEventListener('click', e => {
            if (!this.input.contains(e.target) && !this.results.contains(e.target)) this.hide();
        });
    },

    hide() {
        this.results.classList.add('hidden');
        this.input.setAttribute('aria-expanded', 'false');
        this.active = -1;
    },

    render(q, remote) {
        const needle = q.toLowerCase();
        const local = State.places.filter(p => p.name.toLowerCase().includes(needle) || (p.address || '').toLowerCase().includes(needle)).slice(0, 6);
        const rows = [];
        if (local.length) {
            rows.push(h('div', { class: 'search-section', text: 'Your places' }));
            local.forEach(p => {
                const mark = h('span', { class: `place-mark st-${safeStatus(p.status)}` });
                mark.append(icon(categoryIcon(p.category), 11));
                rows.push(h('div', { class: 'search-result-item', role: 'option', onclick: () => { this.clear(); Sheet.openPlace(p.id); } },
                    mark, h('span', { class: 'search-result-text' }, h('span', { text: p.name }), p.address ? h('small', { text: p.address }) : null)));
            });
        }
        if (remote && remote.length) {
            rows.push(h('div', { class: 'search-section', text: 'On the map' }));
            remote.forEach(r => {
                const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                const pin = h('span', { class: 'search-pin' });
                pin.append(icon('geo-alt-fill', 12));
                const label = String(r.display_name || '');
                rows.push(h('div', { class: 'search-result-item', role: 'option', onclick: () => {
                    this.clear();
                    MapView.map.setView([lat, lng], 16);
                    UI.openPlaceForm({ name: label.split(',')[0], address: label, latitude: lat, longitude: lng, category: 'other' });
                } }, pin, h('span', { class: 'search-result-text' }, h('span', { text: label.split(',')[0] }), h('small', { text: label }))));
            });
        }
        if (!CFG.online) rows.push(h('div', { class: 'search-note', text: 'Map search is off on this server (offline mode).' }));
        else if (remote === null && q.length >= 3) rows.push(h('div', { class: 'search-note', text: 'Searching the map…' }));
        else if (remote && !remote.length && !local.length) rows.push(h('div', { class: 'search-note', text: 'No results.' }));
        if (!rows.length) { this.hide(); return; }
        this.results.replaceChildren(...rows);
        this.results.classList.remove('hidden');
        this.input.setAttribute('aria-expanded', 'true');
        this.active = -1;
    },

    clear() {
        this.input.value = '';
        this.hide();
    },

    onKey(e) {
        const items = [...this.results.querySelectorAll('.search-result-item')];
        if (e.key === 'Escape') { this.hide(); return; }
        if (!items.length || this.results.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items.forEach((el, i) => el.classList.toggle('active', i === this.active));
            items[this.active].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            items[Math.max(this.active, 0)].click();
        }
    },
};

// ---------- import ----------

const Import = {
    init() {
        $('#import-btn').addEventListener('click', () => this.open());
        $('#import-file').addEventListener('change', () => this.preview());
        $('#import-group').addEventListener('change', () => this.preview());
        $('#importBtn').addEventListener('click', () => this.run());
    },

    open() {
        const groups = ownGroups();
        if (!groups.length) { toast('Create a group first'); UI.openGroupForm(); return; }
        $('#import-form').reset();
        $('#import-group').replaceChildren(...groups.map(g => h('option', { value: String(g.id), text: g.name })));
        const last = store.get('places.lastGroup', null);
        if (groups.some(g => g.id === last)) $('#import-group').value = String(last);
        $('#import-preview').hidden = true;
        $('#import-error').hidden = true;
        $('#importBtn').disabled = true;
        $('#importBtn').textContent = 'Import';
        UI.importModal.show();
    },

    form(dryRun) {
        const file = $('#import-file').files[0];
        if (!file) return null;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('group_id', $('#import-group').value);
        fd.append('dry_run', dryRun ? 'true' : 'false');
        return fd;
    },

    async preview() {
        const fd = this.form(true);
        const box = $('#import-preview'), err = $('#import-error'), btn = $('#importBtn');
        err.hidden = true;
        btn.disabled = true;
        if (!fd) { box.hidden = true; return; }
        if ($('#import-file').files[0].size > 5 * 1024 * 1024) { err.textContent = 'This file is over 5 MB.'; err.hidden = false; box.hidden = true; return; }
        box.hidden = false;
        box.replaceChildren(h('span', { class: 'skeleton-box w-55 skeleton-inline' }));
        try {
            const r = await api('/import', { method: 'POST', form: fd });
            const fmt = { geojson: 'GeoJSON', takeout: 'Google Takeout', kml: 'KML' }[r.format] || r.format;
            const parts = [`${plural(r.found, 'place')} found`, `${r.new} new`];
            if (r.duplicates) parts.push(plural(r.duplicates, 'duplicate'));
            if (r.invalid) parts.push(`${r.invalid} skipped (no usable point)`);
            box.replaceChildren(
                h('div', { class: 'import-format', text: `${fmt} file` }),
                h('div', { class: 'import-counts', text: parts.join(' · ') }),
                r.sample.length ? h('div', { class: 'import-sample', text: r.sample.join(', ') + (r.new > r.sample.length ? ', …' : '') }) : null);
            btn.disabled = !r.new;
            btn.textContent = r.new ? `Import ${plural(r.new, 'place')}` : 'Nothing new to import';
        } catch (e) {
            box.hidden = true;
            err.textContent = e.message;
            err.hidden = false;
        }
    },

    async run() {
        const fd = this.form(false);
        if (!fd) return;
        const btn = $('#importBtn');
        btn.disabled = true;
        try {
            const groupId = Number($('#import-group').value);
            const r = await api('/import', { method: 'POST', form: fd });
            State.hiddenGroups.delete(groupId);
            store.set('places.hiddenGroups', [...State.hiddenGroups]);
            store.set('places.lastGroup', groupId);
            UI.importModal.hide();
            await Data.load();
            Data.loadSuggestions();
            toast(`Imported ${plural(r.created, 'place')}`);
            const added = State.places.filter(p => p.group_id === groupId);
            MapView.fitPlaces(added, 15);
        } catch (e) {
            $('#import-error').textContent = e.message;
            $('#import-error').hidden = false;
            btn.disabled = false;
        }
    },
};

// ---------- start ----------

document.addEventListener('DOMContentLoaded', async () => {
    MapView.init();
    UI.init();
    Sheet.init();
    await Data.load();
    if (!State.userPos && !Sheet.pendingId) MapView.fitPlaces(State.places);
    Sheet.afterLoad();
    Data.loadSuggestions();
});
