# Cyan holographic Jan hand proposal

This artwork keeps Jan's waving-hand silhouette and motion marks, using a deep teal fill,
cyan illuminated edges, circuit lines and a transparent background. It is proposed as a
visual alternative for maintainer review.

The image was generated with OpenAI's image-generation tool using Jan's existing hand as
the reference. The original transparent artwork is kept in `src-tauri/app-icon.png` and
the two existing web-logo paths. The Tauri-generated `src-tauri/icons/icon.png` is the
512-pixel desktop source. Runtime logo URLs stay unchanged.

![Cyan holographic Jan hand](../src-tauri/icons/icon.png)

Windows Shell previews of the same installed executable before and after the local update:

| Before | After |
| --- | --- |
| ![Previous Windows icon](./static/img/jan-hand-shell-before.png) | ![Cyan Windows icon](./static/img/jan-hand-shell-after.png) |

Run `yarn build:icon` to regenerate platform icon formats. Generated ICO, ICNS and platform
sizes remain build artifacts under the repository's existing ignore rules. The desktop
build tracks PNG and ICO changes so an icon-only update rebuilds the native resource.

The proposed change contains artwork and icon build tracking only. It does not include
engine upgrades, search-provider changes or conversation behavior changes.
