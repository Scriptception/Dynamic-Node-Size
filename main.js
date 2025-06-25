const { Plugin, Setting, App, PluginSettingTab, TFolder } = require("obsidian");

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

    // Helper to check if a file should be excluded
    isExcluded(file) {
        if (!file) return false;
        const { excludeFolders = [], excludeTitles = [], excludeTags = [] } = this.settings || {};
        // Folder exclusion
        if (excludeFolders.length > 0) {
            for (const folder of excludeFolders) {
                if (file.path.startsWith(folder.endsWith('/') ? folder : folder + '/')) {
                    return true;
                }
            }
        }
        // Title exclusion (filename without extension)
        if (excludeTitles.length > 0) {
            const basename = file.basename;
            for (const title of excludeTitles) {
                if (title.startsWith('/') && title.endsWith('/')) {
                    // Regex
                    const regex = new RegExp(title.slice(1, -1));
                    if (regex.test(basename)) return true;
                } else {
                    if (basename === title) return true;
                }
            }
        }
        // Tag exclusion (frontmatter tags only)
        if (excludeTags.length > 0) {
            const cache = this.app.metadataCache.getFileCache(file);
            let tags = [];
            if (cache?.frontmatter?.tags) {
                if (Array.isArray(cache.frontmatter.tags)) {
                    tags = cache.frontmatter.tags;
                } else if (typeof cache.frontmatter.tags === 'string') {
                    tags = cache.frontmatter.tags.split(/[, ]+/).map(t => t.replace(/^#/, ''));
                }
            }
            if (cache?.frontmatter) {
                for (const key of Object.keys(cache.frontmatter)) {
                    if (key === 'tags' || key === 'tag') continue;
                    if (typeof cache.frontmatter[key] === 'string' && cache.frontmatter[key].startsWith('#')) {
                        tags.push(cache.frontmatter[key].replace(/^#/, ''));
                    }
                }
            }
            for (const tag of excludeTags) {
                if (tags.includes(tag)) return true;
            }
        }
        return false;
    }

    // Calculate total connected nodes including children recursively
    calculateTotalConnectedNodes(nodeId, visited = new Set()) {
        if (visited.has(nodeId)) {
            return 0;
        }
        visited.add(nodeId);

        const file = this.app.vault.getFileByPath(nodeId);
        if (!file || this.isExcluded(file)) {
            return 0;
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
            if (!file || this.isExcluded(file)) return;

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

        // Node Size Controls section
        containerEl.createEl('h2', { text: 'Dynamic Node Size Settings' });
        containerEl.createEl('h3', { text: 'Node Size Controls' });

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
                    refreshAllGraphViews(this.plugin);
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
                    refreshAllGraphViews(this.plugin);
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
                    refreshAllGraphViews(this.plugin);
                }));

        // Restore to Default button (sliders only)
        const restoreBtn = containerEl.createEl('button', { text: 'Restore to Default' });
        restoreBtn.style.marginTop = '1em';
        restoreBtn.onclick = async () => {
            this.plugin.settings.sizeMultiplier = 2.0;
            this.plugin.settings.multiplierScale = 1.0;
            this.plugin.settings.maxSize = 50;
            await this.plugin.saveSettings();
            this.display(); // Refresh UI
            refreshAllGraphViews(this.plugin);
        };

        // Exclusions section
        containerEl.createEl('h3', { text: 'Exclusions' });

        // Exclude Folders (better layout)
        new Setting(containerEl)
            .setName('Exclude Folders')
            .setDesc('Add folders to exclude from dynamic sizing.')
            .addButton(btn => {
                btn.setButtonText('+ Add Folder');
                btn.onClick(() => {
                    const input = containerEl.createEl('input');
                    input.type = 'text';
                    input.placeholder = 'Type to search folders...';
                    input.style.marginTop = '0.5em';
                    new FolderSuggest(this.app, input, async (folderPath) => {
                        if (!this.plugin.settings.excludeFolders.includes(folderPath)) {
                            this.plugin.settings.excludeFolders.push(folderPath);
                            await this.plugin.saveSettings();
                            this.display();
                            refreshAllGraphViews(this.plugin);
                        }
                    });
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter') {
                            const val = input.value.trim();
                            if (val && !this.plugin.settings.excludeFolders.includes(val)) {
                                this.plugin.settings.excludeFolders.push(val);
                                this.plugin.saveSettings().then(() => this.display());
                                refreshAllGraphViews(this.plugin);
                            }
                        }
                    };
                    input.focus();
                });
            });
        // List folders
        if ((this.plugin.settings.excludeFolders || []).length > 0) {
            const folderList = containerEl.createEl('ul', { cls: 'setting-exclude-list' });
            this.plugin.settings.excludeFolders.forEach((folder, idx) => {
                const li = folderList.createEl('li');
                li.setText(folder);
                const btn = li.createEl('button', { text: '✕' });
                btn.onclick = async () => {
                    this.plugin.settings.excludeFolders = this.plugin.settings.excludeFolders.filter((_, i) => i !== idx);
                    await this.plugin.saveSettings();
                    this.display();
                    refreshAllGraphViews(this.plugin);
                };
            });
        }

        // Exclude Page Titles (text area)
        new Setting(containerEl)
            .setName('Exclude Page Titles')
            .setDesc('One page title or regex per line. Matching nodes will be excluded.')
            .addTextArea(text => text
                .setValue((this.plugin.settings?.excludeTitles || []).join('\n'))
                .onChange(async (value) => {
                    this.plugin.settings.excludeTitles = value.split('\n').map(s => s.trim()).filter(Boolean);
                    await this.plugin.saveSettings();
                    refreshAllGraphViews(this.plugin);
                })
                .inputEl.setAttr('rows', 2)
            );

        // Exclude Tags (better layout)
        new Setting(containerEl)
            .setName('Exclude Tags')
            .setDesc('Add tags to exclude from dynamic sizing.')
            .addButton(btn => {
                btn.setButtonText('+ Add Tag');
                btn.onClick(() => {
                    const input = containerEl.createEl('input');
                    input.type = 'text';
                    input.placeholder = 'Type to search tags...';
                    input.style.marginTop = '0.5em';
                    new TagSuggest(this.app, input, async (tag) => {
                        if (!this.plugin.settings.excludeTags.includes(tag)) {
                            this.plugin.settings.excludeTags.push(tag);
                            await this.plugin.saveSettings();
                            this.display();
                            refreshAllGraphViews(this.plugin);
                        }
                    });
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter') {
                            const val = input.value.trim();
                            if (val && !this.plugin.settings.excludeTags.includes(val)) {
                                this.plugin.settings.excludeTags.push(val);
                                this.plugin.saveSettings().then(() => this.display());
                                refreshAllGraphViews(this.plugin);
                            }
                        }
                    };
                    input.focus();
                });
            });
        // List tags
        if ((this.plugin.settings.excludeTags || []).length > 0) {
            const tagList = containerEl.createEl('ul', { cls: 'setting-exclude-list' });
            this.plugin.settings.excludeTags.forEach((tag, idx) => {
                const li = tagList.createEl('li');
                li.setText(tag);
                const btn = li.createEl('button', { text: '✕' });
                btn.onclick = async () => {
                    this.plugin.settings.excludeTags = this.plugin.settings.excludeTags.filter((_, i) => i !== idx);
                    await this.plugin.saveSettings();
                    this.display();
                    refreshAllGraphViews(this.plugin);
                };
            });
        }
    }
}

class FolderSuggest {
    constructor(app, inputEl, onSelect) {
        this.app = app;
        this.inputEl = inputEl;
        this.onSelect = onSelect;
        this.suggestions = [];
        this.inputEl.addEventListener('input', this.onInputChanged.bind(this));
        this.inputEl.addEventListener('focus', this.onInputChanged.bind(this));
        this.suggestEl = createDiv('suggestion-container');
        this.suggestEl.style.position = 'absolute';
        this.suggestEl.style.zIndex = 1000;
        this.suggestEl.style.background = 'var(--background-primary)';
        this.suggestEl.style.border = '1px solid var(--background-modifier-border)';
        this.suggestEl.style.display = 'none';
        document.body.appendChild(this.suggestEl);
        this.inputEl.addEventListener('blur', () => setTimeout(() => this.close(), 200));
    }
    onInputChanged() {
        const inputStr = this.inputEl.value.toLowerCase();
        const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder && f.path.toLowerCase().includes(inputStr));
        this.suggestions = folders;
        this.renderSuggestions();
    }
    renderSuggestions() {
        this.suggestEl.innerHTML = '';
        if (this.suggestions.length === 0) {
            this.suggestEl.style.display = 'none';
            return;
        }
        this.suggestions.forEach(folder => {
            const el = createDiv('suggestion-item');
            el.setText(folder.path);
            el.onclick = () => {
                this.inputEl.value = folder.path;
                this.onSelect(folder.path);
                this.close();
            };
            this.suggestEl.appendChild(el);
        });
        const rect = this.inputEl.getBoundingClientRect();
        this.suggestEl.style.left = rect.left + 'px';
        this.suggestEl.style.top = rect.bottom + 'px';
        this.suggestEl.style.width = rect.width + 'px';
        this.suggestEl.style.display = 'block';
    }
    close() {
        this.suggestEl.style.display = 'none';
    }
}

class TagSuggest {
    constructor(app, inputEl, onSelect) {
        this.app = app;
        this.inputEl = inputEl;
        this.onSelect = onSelect;
        this.suggestions = [];
        this.inputEl.addEventListener('input', this.onInputChanged.bind(this));
        this.inputEl.addEventListener('focus', this.onInputChanged.bind(this));
        this.suggestEl = createDiv('suggestion-container');
        this.suggestEl.style.position = 'absolute';
        this.suggestEl.style.zIndex = 1000;
        this.suggestEl.style.background = 'var(--background-primary)';
        this.suggestEl.style.border = '1px solid var(--background-modifier-border)';
        this.suggestEl.style.display = 'none';
        document.body.appendChild(this.suggestEl);
        this.inputEl.addEventListener('blur', () => setTimeout(() => this.close(), 200));
    }
    getAllTags() {
        const files = this.app.vault.getMarkdownFiles();
        const tags = new Set();
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.tags) {
                for (const tagObj of cache.tags) {
                    tags.add(tagObj.tag.replace(/^#/, ''));
                }
            }
            if (cache?.frontmatter?.tags) {
                if (Array.isArray(cache.frontmatter.tags)) {
                    for (const t of cache.frontmatter.tags) tags.add(t.replace(/^#/, ''));
                } else if (typeof cache.frontmatter.tags === 'string') {
                    for (const t of cache.frontmatter.tags.split(/[, ]+/)) tags.add(t.replace(/^#/, ''));
                }
            }
        }
        return Array.from(tags);
    }
    onInputChanged() {
        const inputStr = this.inputEl.value.toLowerCase();
        const tags = this.getAllTags().filter(tag => tag.toLowerCase().includes(inputStr));
        this.suggestions = tags;
        this.renderSuggestions();
    }
    renderSuggestions() {
        this.suggestEl.innerHTML = '';
        if (this.suggestions.length === 0) {
            this.suggestEl.style.display = 'none';
            return;
        }
        this.suggestions.forEach(tag => {
            const el = createDiv('suggestion-item');
            el.setText(tag);
            el.onclick = () => {
                this.inputEl.value = tag;
                this.onSelect(tag);
                this.close();
            };
            this.suggestEl.appendChild(el);
        });
        const rect = this.inputEl.getBoundingClientRect();
        this.suggestEl.style.left = rect.left + 'px';
        this.suggestEl.style.top = rect.bottom + 'px';
        this.suggestEl.style.width = rect.width + 'px';
        this.suggestEl.style.display = 'block';
    }
    close() {
        this.suggestEl.style.display = 'none';
    }
}

// Helper to refresh all graph views
function refreshAllGraphViews(plugin) {
    const graphLeaves = plugin.app.workspace.getLeavesOfType("graph");
    for (const leaf of graphLeaves) {
        const view = leaf.view;
        if (view && view.renderer) {
            plugin.updateNodeSizes(view);
        }
    }
}

module.exports = DynamicNodeSizePlugin;
