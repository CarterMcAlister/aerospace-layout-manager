# Aerospace Layout Manager

Automate the arrangement of windows into complex, repeatable layouts using aerospace.

This project is a script that drives the excellent [`aerospace`](https://github.com/nikitabobko/AeroSpace) window-manager CLI.  
You describe a layout once (in JSON), then run the script whenever you need that workspace restored.

---

## ✨ Features

* Launches apps if they are not already running.
* Moves / focuses windows into the requested **workspace**.
* Supports nested horizontal & vertical groups for sophisticated tiling.
* Falls back to a configurable "stash" workspace so your primary workspace starts clean.
* One-line listing of all available layouts.
* Optional **fractional sizing** for windows and groups via a simple `size` field (e.g. `"size": "2/3"`).
* Supports **multi-display setups** with the `display` field to correctly calculate window sizes, in a per-layout basis.

---

## 🚀 Installation

Install with Homebrew:

```bash
brew tap CarterMcAlister/tools
brew install aerospace-layout-manager
```

Or install directly without tapping first:

```bash
brew install CarterMcAlister/tools/aerospace-layout-manager
```

You can also install `aerospace-layout-manager` with the install script:

```bash
curl -sSL https://raw.githubusercontent.com/CarterMcAlister/aerospace-layout-manager/main/install.sh | bash
```

This script will automatically detect your operating system and architecture, download the correct release binary, and place it in `/usr/local/bin`.

## 🔧 Configuration (`layouts.json`)

```json
{
  "stashWorkspace": "S",
  "layouts": {
    "work": {
      "workspace": "1",
      "layout": "v_tiles",
      "orientation": "vertical",
      "windows": [
        { "bundleId": "com.apple.Safari" },
        {
          "orientation": "horizontal",
          "windows": [
            { "bundleId": "com.jetbrains.WebStorm", "size": "2/3" },
            { "bundleId": "com.apple.Terminal", "size": "1/3" }
          ]
        }
      ]
    }
  }
}
```

Field reference:

* **stashWorkspace** – workspace whose windows will be used as temporary storage.
* **layouts** → each key is a layout name you can invoke.
  * **workspace** – target workspace (string or number) for the layout.
  * **layout** – one of Aerospace's layout names (`tiles`, `h_tiles`, `v_tiles`, `floating`, …).
  * **orientation** – default orientation for nested groups (`horizontal` or `vertical`).
  * **windows** – recursive array of:
    * `{ "bundleId": "…", "size": "n/d" }` – an application window, optionally sized as a fraction.
    * `{ "orientation": "horizontal" | "vertical", "size": "n/d", "windows": [ … ] }` – a nested group, optionally sized as a fraction.
  * **size** – *(optional)* fractional width/height (`"numerator/denominator"`). In a horizontal context (`orientation: "horizontal"`) the fraction controls width; in a vertical context it controls height.
  * **display** – *(optional)* display *name* or *ID* (as shown by `system_profiler SPDisplaysDataType`), or a valid alias (`main`, `secondary`, `external`, `internal`).
    * In multi-display setups, you can specify the target display for a layout in order to correctly calculate window sizes (if specified with `size`). By default, the layout will be applied to the primary display.

---

## ▶️  Usage

Once installed, you can use the `aerospace-layout-manager` command.

First, add a layouts file to `~/.config/aerospace/layouts.json`. See the [Configuration](#-configuration-layoutsjson) section for details.

### List available layouts

```bash
aerospace-layout-manager --listLayouts
# or: aerospace-layout-manager -L
```

### Apply a layout

```bash
# by long option
aerospace-layout-manager --layout work

# by short option
aerospace-layout-manager -l work

# or simply pass the name as a positional argument
aerospace-layout-manager work
```

### Use an alternate config file

```bash
aerospace-layout-manager --configFile ~/my-layouts/presentation.json -l keynote
```

---

## ⚙️  How it works (high level)

1. **Clear** – moves every window currently in the target workspace to `stashWorkspace`.
2. **Move** – ensures each app is running, then moves its first window into the layout's workspace, depth-first.
3. **Reposition** – flattens the workspace, sets the requested layout type, and joins / splits panes according to the JSON hierarchy.
4. **Resize** - sets the windows to the fractional sizes, if specified
5. **Focus** – switches to the fully-arranged workspace.

The logic lives in [`index.ts`](./index.ts) and is intentionally kept readable if you need to tweak timings or behaviour.
