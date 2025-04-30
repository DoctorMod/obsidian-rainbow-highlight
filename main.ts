import { Plugin, MarkdownView, MarkdownPostProcessorContext, editorViewField } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import {
    ViewPlugin,
    Decoration,
    DecorationSet,
    ViewUpdate,
    EditorView,
} from '@codemirror/view';
// Import ensureSyntaxTree
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';

// Define the NEW rainbow colors (with alpha transparency)
const RAINBOW_COLORS = [
    '#FFB8EBA6', // Pink ~65% opacity
    '#FF5582A6', // Red ~65% opacity
    '#FFB86CA6', // Orange ~65% opacity
    '#FFF3A3A6', // Yellow ~65% opacity
    '#BBFABBA6', // Green ~65% opacity
    '#ADCCFFA6', // Blue ~65% opacity
    '#D2B3FFA6', // Purple ~65% opacity
];

// Helper function for binary search
function binarySearch(arr: number[], target: number): number {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (arr[mid] === target) {
            return mid; // Found
        } else if (arr[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return -1; // Not found
}

// --- CodeMirror 6 ViewPlugin for Live Preview / Source Mode ---

const rainbowViewPlugin = ViewPlugin.fromClass(
    class RainbowViewPlugin {
        decorations: DecorationSet;
        highlightPositions: number[] = []; // Store positions of all highlights

        constructor(view: EditorView) {
            // Initial collection needs to happen *before* buildDecorations
            this.collectAllHighlights(view);
            this.decorations = this.buildDecorations(view);
        }

        // Collect all highlight positions in the document
        collectAllHighlights(view: EditorView) {
            console.log("Rainbow Highlightr: Collecting all highlights");
            this.highlightPositions = [];
            const collectedForLog: number[] = [];
            const docLength = view.state.doc.length;

            // Ensure the syntax tree is available up to the document end
            // Timeout (e.g., 100ms) prevents blocking indefinitely if parsing is slow.
            // Adjust timeout if needed for very large files.
            const tree = ensureSyntaxTree(view.state, docLength, 100); // <-- Force parse

            if (!tree) {
                console.warn("Rainbow Highlightr: Syntax tree not fully available after timeout in collectAllHighlights.");
                // Attempt to use the potentially incomplete tree anyway, or return
                // Using the potentially incomplete tree might lead to partial collection
                syntaxTree(view.state).iterate({ /* ... rest of iteration ... */ }); // Fallback to potentially incomplete tree
                // OR simply return if a complete tree is essential:
                // return;
            } else {
                // Iterate using the ensured tree
                tree.iterate({
                    from: 0,
                    to: docLength,
                    enter: (nodeRef) => {
                        if (nodeRef.type.name.includes('highlight')) {
                            if (nodeRef.from < nodeRef.to) {
                                // Check if already added (using collectedForLog as it's not sorted yet)
                                if (collectedForLog.length === 0 || collectedForLog[collectedForLog.length - 1] !== nodeRef.from) {
                                    // Check against the actual last element added to collectedForLog before sorting
                                    // This check might be less reliable if nodes aren't strictly sequential
                                    // A better check might be needed if duplicates still occur
                                    this.highlightPositions.push(nodeRef.from);
                                    collectedForLog.push(nodeRef.from);
                                }
                            }
                        }
                    },
                });
            }

            // Sort positions to ensure consistent ordering for binary search and color cycling
            this.highlightPositions.sort((a, b) => a - b);
        }

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>();

            // Apply decorations only to visible ranges
            for (const { from, to } of view.visibleRanges) {
                syntaxTree(view.state).iterate({
                    from,
                    to,
                    enter: (nodeRef) => {
                        if (nodeRef.type.name.includes('highlight')) {
                            const nodeStart = nodeRef.from;
                            const nodeEnd = nodeRef.to;

                            // Default decoration range is the full node range
                            let decorationStart = nodeStart;
                            let decorationEnd = nodeEnd;

                            // Check if the node text actually starts and ends with ==
                            if (nodeEnd > nodeStart + 3) { // Ensure there's room for ==text==
                                const nodeText = view.state.doc.sliceString(nodeStart, nodeEnd);
                                if (nodeText.startsWith('==') && nodeText.endsWith('==')) {
                                    decorationStart = nodeStart + 2;
                                    decorationEnd = nodeEnd - 2;
                                }
                            }

                            if (decorationStart < decorationEnd) {
                                const colorIndex = binarySearch(this.highlightPositions, nodeStart);

                                if (colorIndex === -1) {
                                    console.warn("Rainbow Highlightr: Highlight start position not found in collected list:", nodeStart);
                                    // Log the collected positions for comparison when an error occurs
                                    console.log("Collected positions array:", JSON.stringify(this.highlightPositions));
                                    return;
                                }

                                const color = RAINBOW_COLORS[Math.floor(colorIndex / 3) % RAINBOW_COLORS.length];
                                const decoration = Decoration.mark({
                                    attributes: {
                                        style: `background-color: ${color}; color: ${getContrastYIQ(color)};`,
                                    },
                                });
                                builder.add(decorationStart, decorationEnd, decoration);
                            }
                        }
                    },
                });
            }
            return builder.finish();
        }

        update(update: ViewUpdate) {
            let needsRecollect = update.docChanged;
            let needsRebuild = update.docChanged || update.viewportChanged;

            if (needsRecollect) {
                // Full recollect and rebuild
                this.collectAllHighlights(update.view);
                this.decorations = this.buildDecorations(update.view);
            } else if (needsRebuild) {
                // Only rebuild based on existing positions if only viewport changed
                this.decorations = this.buildDecorations(update.view);
            }
        }
    },
    {
        decorations: (v) => v.decorations,
    }
);

// --- Helper Function for Text Contrast ---
function getContrastYIQ(hexcolor: string): string {
    hexcolor = hexcolor.replace("#", "");
    const r = parseInt(hexcolor.substring(0, 2), 16);
    const g = parseInt(hexcolor.substring(2, 4), 16);
    const b = parseInt(hexcolor.substring(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? 'black' : 'white';
}

// --- Main Plugin Class ---

export default class RainbowTagsPlugin extends Plugin {

    async onload() {
        console.log('Loading Rainbow Tags Plugin');

        // 1. Register the CodeMirror 6 ViewPlugin
        this.registerEditorExtension(rainbowViewPlugin);

        // 2. Register the Markdown Post Processor for Reading View
        this.registerMarkdownPostProcessor(this.postProcessor.bind(this));

        // 3. Force refresh views
        this.app.workspace.updateOptions();
    }

    onunload() {
        console.log('Unloading Rainbow Tags Plugin');
        // Force refresh views to attempt removal (full removal might need restart)
        this.app.workspace.updateOptions();
    }

    // --- Markdown Post Processor for Reading View ---
    postProcessor(element: HTMLElement, context: MarkdownPostProcessorContext) {
        const marks = element.querySelectorAll('mark');
        let colorIndex = 0; // Reset index for each processed block/section

        marks.forEach((mark) => {
            const color = RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length];
            mark.style.backgroundColor = color;
            mark.style.color = getContrastYIQ(color);
            colorIndex++;
        });
    }
}