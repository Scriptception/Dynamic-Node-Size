const { Plugin, Setting, App, PluginSettingTab } = require("obsidian");

class DynamicNodeSizePlugin extends Plugin {
    async onload() {
        // Load settings first
        await this.loadSettings();
        
        // Add settings
        this.addSettingTab(new DynamicNodeSizeSettingTab(this.app, this));
        
        // Store intervals to avoid stacking
        this.graphIntervals = new Map();

        // Register the layout change event
        this.registerEvent(
            this.app.workspace.on("layout-change", () => {
                // Get all graph leaves
                const graphLeaves = this.app.workspace.getLeavesOfType("graph");
                for (const leaf of graphLeaves) {
                    const view = leaf.view;
                    if (!view) continue;
                    // Avoid stacking intervals
                    if (this.graphIntervals.has(view)) continue;
                    const interval = setInterval(() => {
                        if (view && view.renderer) {
                            this.updateNodeSizes(view);
                        }
                    }, 1000);
                    this.graphIntervals.set(view, interval);
                }
                // Clean up intervals for closed views
                for (const [view, interval] of this.graphIntervals.entries()) {
                    if (!graphLeaves.some(l => l.view === view)) {
                        clearInterval(interval);
                        this.graphIntervals.delete(view);
                    }
                }
            })
        );
    }

    onunload() {
        // Clean up all intervals
        for (const interval of this.graphIntervals.values()) {
            clearInterval(interval);
        }
        this.graphIntervals.clear();
    }

    // Calculate total connected nodes including children recursively
    calculateTotalConnectedNodes(nodeId, visited = new Set()) {
        if (visited.has(nodeId)) {
            return 0;
        }
        visited.add(nodeId);

        const file = this.app.vault.getFileByPath(nodeId);
        if (!file) {
            return 1; // Count the node itself even if file doesn't exist
        }

        // Get all links from this file
        const links = this.app.metadataCache.resolvedLinks[file.path] || {};
        let totalConnected = 1; // Start with 1 for the current node

        // Recursively count all connected nodes
        for (const linkedPath in links) {
            totalConnected += this.calculateTotalConnectedNodes(linkedPath, visited);
        }

        return totalConnected;
    }

    updateNodeSizes(view) {
        const { renderer } = view;
        if (!renderer) return;

        const multiplier = this.settings?.sizeMultiplier || 1.0;
        const multiplierScale = this.settings?.multiplierScale || 1.0;
        const maxSize = this.settings?.maxSize || 50;

        renderer.nodes.forEach(node => {
            const file = this.app.vault.getFileByPath(node.id);
            if (!file) return;

            // Check if there's a manual node_size in frontmatter first
            const fileCache = this.app.metadataCache.getFileCache(file);
            const manualSize = fileCache?.frontmatter?.node_size;

            if (manualSize) {
                // Use manual size if specified
                node.weight = manualSize;
            } else {
                // Calculate dynamic size based on connected nodes
                const totalConnected = this.calculateTotalConnectedNodes(node.id);
                const calculatedSize = Math.min(totalConnected * multiplier * multiplierScale, maxSize);
                node.weight = Math.max(calculatedSize, 1); // Minimum size of 1
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, {
            sizeMultiplier: 2.0,
            multiplierScale: 1.0,
            maxSize: 50
        }, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class DynamicNodeSizeSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Dynamic Node Size Settings' });

        new Setting(containerEl)
            .setName('Size Multiplier')
            .setDesc('Multiplier for calculating node size based on connected nodes. Higher values make nodes larger.')
            .addSlider(slider => slider
                .setLimits(0.1, 10, 0.1)
                .setValue(this.plugin.settings?.sizeMultiplier || 2.0)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.sizeMultiplier = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Multiplier Scale')
            .setDesc('Additional scale factor applied to the calculated node size for fine-tuning.')
            .addSlider(slider => slider
                .setLimits(0.1, 5, 0.05)
                .setValue(this.plugin.settings?.multiplierScale || 1.0)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.multiplierScale = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Maximum Node Size')
            .setDesc('Maximum size a node can reach to prevent extremely large nodes.')
            .addSlider(slider => slider
                .setLimits(10, 200, 5)
                .setValue(this.plugin.settings?.maxSize || 50)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxSize = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('p', { 
            text: 'Note: Nodes with a "node_size" property in their frontmatter will use that value instead of the calculated size.',
            cls: 'setting-item-description'
        });

        // Restore to Default button
        const defaultSettings = {
            sizeMultiplier: 2.0,
            multiplierScale: 1.0,
            maxSize: 50
        };
        const restoreBtn = containerEl.createEl('button', { text: 'Restore to Default' });
        restoreBtn.style.marginTop = '1em';
        restoreBtn.onclick = async () => {
            this.plugin.settings = { ...defaultSettings };
            await this.plugin.saveSettings();
            this.display(); // Refresh UI
        };
    }
}

module.exports = DynamicNodeSizePlugin;

