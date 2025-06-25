# Dynamic Node Size

Dynamically size graph nodes in Obsidian based on their connected nodes (including children). Features configurable multiplier, scale, and maximum size limits.

## Features
- **Dynamic Sizing:** Node size is calculated based on the total number of connected nodes, including all children recursively.
- **Configurable Multiplier:** Adjust how much the number of connections affects node size.
- **Multiplier Scale:** Fine-tune the scaling of node sizes globally.
- **Maximum Node Size:** Prevents nodes from becoming excessively large.
- **Frontmatter Override:** Set a custom size for any node using the `node_size` property in the note's frontmatter.
- **Exclusions:** Easily exclude folders, tags, or page titles from dynamic sizing using autocomplete pickers and text input.

## Installation
1. Download or clone this repository into your Obsidian vault's `plugins` folder (usually `.obsidian/plugins/dynamic-node-size`).
2. Make sure the files `main.js` and `manifest.json` are present in the plugin folder.
3. Enable **Dynamic Node Size** in Obsidian's Community Plugins settings.

## Usage
- Open your graph view in Obsidian. Node sizes will automatically update based on their connections.
- Adjust settings in **Settings → Community Plugins → Dynamic Node Size** to fine-tune the behavior.

## Settings
### Node Size Controls
- **Size Multiplier:** Controls how much the number of connected nodes affects the node size (slider).
- **Multiplier Scale:** Additional global scaling factor for all node sizes (slider).
- **Maximum Node Size:** Caps the maximum size a node can reach (slider).
- **Restore to Default:** Resets only the above sliders to their default values.

### Exclusions
- **Exclude Folders:** Add folders to exclude from dynamic sizing using an autocomplete picker. Remove folders with a single click.
- **Exclude Tags:** Add tags to exclude from dynamic sizing using an autocomplete picker. Remove tags with a single click.
- **Exclude Page Titles:** Enter one page title or regex per line. Matching nodes will be excluded from dynamic sizing.

## Frontmatter Override
To manually set a node's size, add the following to your note's frontmatter:

```yaml
---
node_size: 10
---
```

## License
MIT 