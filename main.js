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
    calculateTotalConnectedNodes(nodeId, visited = new Set(), currentDepth = 0) {
        if (visited.has(nodeId)) {
            return 0;
        }
        visited.add(nodeId);

        const file = this.app.vault.getFileByPath(nodeId);
        if (!file || this.isExcluded(file)) {
            return 0;
        }

        // Check if we've reached the maximum depth
        const maxDepth = this.settings?.maxDepth || 3;
        if (currentDepth >= maxDepth) {
            return 1; // Count only the current node, don't go deeper
        }

        // Get all links from this file
        const links = this.app.metadataCache.resolvedLinks[file.path] || {};
        let totalConnected = 1; // Start with 1 for the current node

        // Recursively count all connected nodes
        for (const linkedPath in links) {
            totalConnected += this.calculateTotalConnectedNodes(linkedPath, visited, currentDepth + 1);
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
            maxSize: 50,
            maxDepth: 3,
            excludeFolders: [],
            excludeTitles: [],
            excludeTags: []
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

        new Setting(containerEl)
            .setName('Maximum Depth')
            .setDesc('Maximum depth to traverse when calculating connected nodes. Lower values improve performance and focus on direct connections.')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings?.maxDepth || 3)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxDepth = value;
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
            this.plugin.settings.maxDepth = 3;
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
                    if (!this.plugin.settings.excludeFolders) {
                        this.plugin.settings.excludeFolders = [];
                    }
                    this.plugin.settings.excludeFolders.push('');
                    this.plugin.saveSettings().then(() => this.display());
                    refreshAllGraphViews(this.plugin);
                });
            });
        // List folders
        if ((this.plugin.settings.excludeFolders || []).length > 0) {
            this.plugin.settings.excludeFolders.forEach((folder, idx) => {
                const s = new Setting(containerEl)
                    .addSearch((cb) => {
                        new FolderSuggest(this.app, cb.inputEl);
                        cb.setPlaceholder('Folder')
                          .setValue(folder)
                          .onChange(async (newFolder) => {
                              this.plugin.settings.excludeFolders[idx] = newFolder.trim();
                              await this.plugin.saveSettings();
                              refreshAllGraphViews(this.plugin);
                          });
                    })
                    .addExtraButton((cb) => {
                        cb.setIcon('up-chevron-glyph')
                          .setTooltip('Move up')
                          .onClick(async () => {
                              if (idx > 0) {
                                  const temp = this.plugin.settings.excludeFolders[idx];
                                  this.plugin.settings.excludeFolders[idx] = this.plugin.settings.excludeFolders[idx - 1];
                                  this.plugin.settings.excludeFolders[idx - 1] = temp;
                                  await this.plugin.saveSettings();
                                  this.display();
                                  refreshAllGraphViews(this.plugin);
                              }
                          });
                    })
                    .addExtraButton((cb) => {
                        cb.setIcon('down-chevron-glyph')
                          .setTooltip('Move down')
                          .onClick(async () => {
                              if (idx < this.plugin.settings.excludeFolders.length - 1) {
                                  const temp = this.plugin.settings.excludeFolders[idx];
                                  this.plugin.settings.excludeFolders[idx] = this.plugin.settings.excludeFolders[idx + 1];
                                  this.plugin.settings.excludeFolders[idx + 1] = temp;
                                  await this.plugin.saveSettings();
                                  this.display();
                                  refreshAllGraphViews(this.plugin);
                              }
                          });
                    })
                    .addExtraButton((cb) => {
                        cb.setIcon('cross')
                          .setTooltip('Delete')
                          .onClick(async () => {
                              this.plugin.settings.excludeFolders.splice(idx, 1);
                              await this.plugin.saveSettings();
                              this.display();
                              refreshAllGraphViews(this.plugin);
                          });
                    });
                s.infoEl.remove();
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
                    if (!this.plugin.settings.excludeTags) {
                        this.plugin.settings.excludeTags = [];
                    }
                    this.plugin.settings.excludeTags.push('');
                    this.plugin.saveSettings().then(() => this.display());
                    refreshAllGraphViews(this.plugin);
                });
            });
        // List tags
        if ((this.plugin.settings.excludeTags || []).length > 0) {
            this.plugin.settings.excludeTags.forEach((tag, idx) => {
                const s = new Setting(containerEl)
                    .addSearch((cb) => {
                        new TagSuggest(this.app, cb.inputEl);
                        cb.setPlaceholder('Tag')
                          .setValue(tag)
                          .onChange(async (newTag) => {
                              this.plugin.settings.excludeTags[idx] = newTag.trim();
                              await this.plugin.saveSettings();
                              refreshAllGraphViews(this.plugin);
                          });
                    })
                    .addExtraButton((cb) => {
                        cb.setIcon('up-chevron-glyph')
                          .setTooltip('Move up')
                          .onClick(async () => {
                              if (idx > 0) {
                                  const temp = this.plugin.settings.excludeTags[idx];
                                  this.plugin.settings.excludeTags[idx] = this.plugin.settings.excludeTags[idx - 1];
                                  this.plugin.settings.excludeTags[idx - 1] = temp;
                                  await this.plugin.saveSettings();
                                  this.display();
                                  refreshAllGraphViews(this.plugin);
                              }
                          });
                    })
                    .addExtraButton((cb) => {
                        cb.setIcon('down-chevron-glyph')
                          .setTooltip('Move down')
                          .onClick(async () => {
                              if (idx < this.plugin.settings.excludeTags.length - 1) {
                                  const temp = this.plugin.settings.excludeTags[idx];
                                  this.plugin.settings.excludeTags[idx] = this.plugin.settings.excludeTags[idx + 1];
                                  this.plugin.settings.excludeTags[idx + 1] = temp;
                                  await this.plugin.saveSettings();
                                  this.display();
                                  refreshAllGraphViews(this.plugin);
                              }
                          });
                    })
                    .addExtraButton((cb) => {
                        cb.setIcon('cross')
                          .setTooltip('Delete')
                          .onClick(async () => {
                              this.plugin.settings.excludeTags.splice(idx, 1);
                              await this.plugin.saveSettings();
                              this.display();
                              refreshAllGraphViews(this.plugin);
                          });
                    });
                s.infoEl.remove();
            });
        }
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

// Suggestion classes based on auto.js implementation
class TextInputSuggest {
    constructor(app, inputEl) {
        this.app = app;
        this.inputEl = inputEl;
        this.scope = new (require('obsidian')).Scope();
        this.suggestEl = createDiv('suggestion-container');
        const suggestion = this.suggestEl.createDiv('suggestion');
        this.suggest = new Suggest(this, suggestion, this.scope);
        this.scope.register([], 'Escape', this.close.bind(this));
        this.inputEl.addEventListener('input', this.onInputChanged.bind(this));
        this.inputEl.addEventListener('focus', this.onInputChanged.bind(this));
        this.inputEl.addEventListener('blur', () => setTimeout(() => this.close(), 200));
        this.suggestEl.on('mousedown', '.suggestion-container', (event) => {
            event.preventDefault();
        });
    }

    onInputChanged() {
        const inputStr = this.inputEl.value;
        const suggestions = this.getSuggestions(inputStr);
        if (suggestions.length > 0) {
            this.suggest.setSuggestions(suggestions);
            this.open(this.app.dom.appContainerEl, this.inputEl);
        }
    }

    open(container, inputEl) {
        // Manual positioning
        const rect = inputEl.getBoundingClientRect();
        this.suggestEl.style.position = 'absolute';
        this.suggestEl.style.left = `${rect.left + window.scrollX}px`;
        this.suggestEl.style.top = `${rect.bottom + window.scrollY}px`;
        this.suggestEl.style.width = `${rect.width}px`;
        this.suggestEl.style.zIndex = 1000;
        container.appendChild(this.suggestEl);
    }

    close() {
        this.app.keymap.popScope(this.scope);
        this.suggest.setSuggestions([]);
        if (this.popper) {
            this.popper.destroy();
        }
        this.suggestEl.detach();
    }

    getSuggestions(inputStr) {
        return [];
    }

    renderSuggestion(value, el) {
        el.setText(value);
    }

    selectSuggestion(value) {
        this.inputEl.value = value;
        if (this.inputEl.trigger) {
            this.inputEl.trigger('input');
        } else {
            // Fallback for when trigger is not available
            this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this.close();
    }
}

class FolderSuggest extends TextInputSuggest {
    getSuggestions(inputStr) {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const folders = [];
        const lowerCaseInputStr = inputStr.toLowerCase();
        abstractFiles.forEach((folder) => {
            if (folder instanceof TFolder && folder.path.toLowerCase().includes(lowerCaseInputStr)) {
                folders.push(folder);
            }
        });
        return folders;
    }

    renderSuggestion(file, el) {
        el.setText(file.path);
    }

    selectSuggestion(file) {
        this.inputEl.value = file.path;
        if (this.inputEl.trigger) {
            this.inputEl.trigger('input');
        } else {
            // Fallback for when trigger is not available
            this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this.close();
    }
}

class TagSuggest extends TextInputSuggest {
    getSuggestions(inputStr) {
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
        const tagList = Array.from(tags);
        const tagMatch = [];
        const lowerCaseInputStr = inputStr.toLowerCase();
        tagList.forEach((tag) => {
            if (tag.toLowerCase().includes(lowerCaseInputStr)) {
                tagMatch.push(tag);
            }
        });
        return tagMatch;
    }

    renderSuggestion(tag, el) {
        el.setText(tag);
    }

    selectSuggestion(tag) {
        this.inputEl.value = tag;
        if (this.inputEl.trigger) {
            this.inputEl.trigger('input');
        } else {
            // Fallback for when trigger is not available
            this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this.close();
    }
}

class Suggest {
    constructor(owner, containerEl, scope) {
        this.owner = owner;
        this.containerEl = containerEl;
        containerEl.on('click', '.suggestion-item', this.onSuggestionClick.bind(this));
        containerEl.on('mousemove', '.suggestion-item', this.onSuggestionMouseover.bind(this));
        scope.register([], 'ArrowUp', (event) => {
            if (!event.isComposing) {
                this.setSelectedItem(this.selectedItem - 1, true);
                return false;
            }
        });
        scope.register([], 'ArrowDown', (event) => {
            if (!event.isComposing) {
                this.setSelectedItem(this.selectedItem + 1, true);
                return false;
            }
        });
        scope.register([], 'Enter', (event) => {
            if (!event.isComposing) {
                this.useSelectedItem(event);
                return false;
            }
        });
    }

    onSuggestionClick(event, el) {
        event.preventDefault();
        const item = this.suggestions.indexOf(el);
        this.setSelectedItem(item, false);
        this.useSelectedItem(event);
    }

    onSuggestionMouseover(_event, el) {
        const item = this.suggestions.indexOf(el);
        this.setSelectedItem(item, false);
    }

    setSuggestions(values) {
        this.containerEl.empty();
        const suggestionEls = [];
        values.forEach((value) => {
            const suggestionEl = this.containerEl.createDiv('suggestion-item');
            this.owner.renderSuggestion(value, suggestionEl);
            suggestionEls.push(suggestionEl);
        });
        this.values = values;
        this.suggestions = suggestionEls;
        this.setSelectedItem(0, false);
    }

    useSelectedItem(event) {
        const currentValue = this.values[this.selectedItem];
        if (currentValue) {
            this.owner.selectSuggestion(currentValue, event);
        }
    }

    setSelectedItem(selectedIndex, scrollIntoView) {
        const normalizedIndex = (selectedIndex % this.suggestions.length + this.suggestions.length) % this.suggestions.length;
        const prevSelectedSuggestion = this.suggestions[this.selectedItem];
        const selectedSuggestion = this.suggestions[normalizedIndex];
        if (prevSelectedSuggestion) prevSelectedSuggestion.removeClass('is-selected');
        if (selectedSuggestion) selectedSuggestion.addClass('is-selected');
        this.selectedItem = normalizedIndex;
        if (scrollIntoView) {
            selectedSuggestion.scrollIntoView(false);
        }
    }
}

// Simple popper implementation for suggestions
function createPopper(reference, popper, options) {
    return {
        destroy: () => {
            if (popper.parentNode) {
                popper.parentNode.removeChild(popper);
            }
        },
        update: () => {}
    };
}

// Helper function to create div elements
function createDiv(className) {
    const div = document.createElement('div');
    if (className) {
        div.className = className;
    }
    // Add createDiv method to the div for suggestion elements
    div.createDiv = function(cls) {
        const childDiv = document.createElement('div');
        if (cls) {
            childDiv.className = cls;
        }
        this.appendChild(childDiv);
        return childDiv;
    };
    // Add event handling methods
    div.on = function(event, selector, callback) {
        if (selector && callback) {
            // Event delegation
            this.addEventListener(event, (e) => {
                if (e.target.matches(selector)) {
                    callback(e, e.target);
                }
            });
        } else {
            // Direct event binding
            this.addEventListener(event, selector);
        }
    };
    div.removeClass = function(cls) {
        this.classList.remove(cls);
    };
    div.addClass = function(cls) {
        this.classList.add(cls);
    };
    div.detach = function() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    };
    div.setText = function(text) {
        this.textContent = text;
    };
    return div;
}

module.exports = DynamicNodeSizePlugin;
