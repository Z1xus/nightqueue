# nightqueue Spicetify extension

Right-click "Play in Discord" submenu that sends selected Spotify URIs to the nightqueue backend.

## Install

```bash
bun run build                                   # bundles dist/nightqueue.js
cp dist/nightqueue.js "$(spicetify -c | xargs dirname)/Extensions/"
spicetify config extensions nightqueue.js
spicetify apply
```

Set the backend URL and connect your account from the "Play in Discord" submenu.
