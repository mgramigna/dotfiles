import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	Input,
	SelectList,
	Text,
	getKeybindings,
	type Component,
	type Focusable,
	type SelectItem,
} from "@earendil-works/pi-tui";

export type AutocompleteSelectItem = SelectItem;

export interface AutocompleteSelectTheme {
	fg: (color: string, text: string) => string;
	bg?: (color: string, text: string) => string;
	bold: (text: string) => string;
}

export interface AutocompleteSelectOptions {
	title: string;
	items: AutocompleteSelectItem[];
	maxVisible?: number;
	helpText?: string;
	noMatchText?: string;
	initialQuery?: string;
	/** Return the text searched by the default fuzzy matcher. */
	getSearchText?: (item: AutocompleteSelectItem) => string;
	/** Replace fuzzy matching when callers need exact, scoped, or domain-specific matching. */
	filter?: (items: readonly AutocompleteSelectItem[], query: string) => AutocompleteSelectItem[];
	onQueryChange?: (query: string) => void;
}

const defaultSearchText = (item: AutocompleteSelectItem): string =>
	`${item.label} ${item.value} ${item.description ?? ""}`;

/** A reusable, bounded, fuzzy-filterable picker built from pi TUI primitives. */
export class AutocompleteSelect implements Component, Focusable {
	private readonly input = new Input();
	private readonly allItems: AutocompleteSelectItem[];
	private readonly options: AutocompleteSelectOptions;
	private readonly theme: AutocompleteSelectTheme;
	private readonly border: DynamicBorder;
	private selectList: SelectList;
	private filteredItems: AutocompleteSelectItem[];
	private _focused = false;

	public onSelect?: (item: AutocompleteSelectItem) => void;
	public onCancel?: () => void;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(options: AutocompleteSelectOptions, theme: AutocompleteSelectTheme) {
		this.options = options;
		this.theme = theme;
		this.allItems = [...options.items];
		this.filteredItems = this.allItems;
		this.border = new DynamicBorder((s: string) => theme.fg("accent", s));
		this.input.setValue(options.initialQuery ?? "");
		this.selectList = this.createSelectList(this.filteredItems);
		this.applyFilter(this.input.getValue(), false);
	}

	render(width: number): string[] {
		const inputWidth = Math.max(1, width - 9);
		const inputLine = this.input.render(inputWidth)[0] ?? "";
		const noMatch = this.filteredItems.length === 0
			? [this.theme.fg("warning", `  ${this.options.noMatchText ?? "No matching items"}`)]
			: this.selectList.render(width);

		return [
			...this.border.render(width),
			this.theme.fg("accent", this.theme.bold(this.options.title)),
			this.theme.fg("dim", "Filter: ") + inputLine,
			...noMatch,
			this.theme.fg("dim", this.options.helpText ?? "Type to fuzzy filter • ↑↓ navigate • enter select • esc cancel"),
			...this.border.render(width),
		];
	}

	handleInput(data: string): void {
	if (this.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}
		if (this.matches(data, "tui.select.up") || this.matches(data, "tui.select.down") || this.matches(data, "tui.select.confirm")) {
			this.selectList.handleInput(data);
			return;
		}

		const before = this.input.getValue();
		this.input.handleInput(data);
		const after = this.input.getValue();
		if (after !== before) this.applyFilter(after);
	}

	invalidate(): void {
		this.border.invalidate();
		this.input.invalidate();
		this.selectList.invalidate();
	}

	private createSelectList(items: AutocompleteSelectItem[]): SelectList {
		const list = new SelectList(items, Math.max(1, this.options.maxVisible ?? 10), {
			selectedPrefix: (text) => this.theme.fg("accent", text),
			selectedText: (text) => this.theme.bg
				? this.theme.bg("selectedBg", this.theme.fg("accent", text))
				: this.theme.fg("accent", text),
			description: (text) => this.theme.fg("muted", text),
			scrollInfo: (text) => this.theme.fg("dim", text),
			noMatch: () => "",
		});
		list.onSelect = (item) => this.onSelect?.(item);
		list.onCancel = () => this.onCancel?.();
		return list;
	}

	private applyFilter(query: string, notify = true): void {
		const search = query.trim();
		this.filteredItems = this.options.filter
			? this.options.filter(this.allItems, search)
			: fuzzyFilter(this.allItems, search, this.options.getSearchText ?? defaultSearchText);
		this.selectList = this.createSelectList(this.filteredItems);
		if (notify) this.options.onQueryChange?.(query);
	}

	private matches(data: string, action: string): boolean {
		return getKeybindings().matches(data, action as any);
	}
}

export async function autocompleteSelect(ctx: any, options: AutocompleteSelectOptions): Promise<string | undefined> {
	return ctx.ui.custom((tui: any, theme: AutocompleteSelectTheme, _keybindings: any, done: (value: string | undefined) => void) => {
		const component = new AutocompleteSelect(options, theme);
		component.onSelect = (item) => done(item.value);
		component.onCancel = () => done(undefined);
		return {
			get focused() { return component.focused; },
			set focused(value: boolean) { component.focused = value; },
			render: (width: number) => component.render(width),
			invalidate: () => component.invalidate(),
			handleInput: (data: string) => {
				component.handleInput(data);
				tui.requestRender();
			},
		};
	});
}
