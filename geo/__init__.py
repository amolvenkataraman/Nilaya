"""Places and maps through placewise: the one place-name, place-search and geo-maths source on the server.

placewise runs as its own local service (`placewise serve`, started with the rest of the platform), so its
place data sits in memory once and other programs on the server can use it too. This package is the only
code that talks to it: `geo.service` (the client, with short timeouts and a clear error when it's down)
and `geo.naming` (what a photo's city, state and country are)."""
