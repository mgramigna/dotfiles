import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	Input,
	SelectList,
	Text,
	type Component,
	type Focusable,
	type SelectItem,
} from "@earendil-works/pi-tui";

export type AutocompleteSelectItem = SelectItem;

export interface AutocompleteSelectOptions {
	title: string;
	items: AutocompleteSelectItem[];
	maxVisible?: number;
	helpText?: string;
	noMatchText?: string;
}

export class AutocompleteSelect implements Component, Focusable {
	private readonly container = new Container();
	private readonly input = new Input();
	private readonly selectList: SelectList;
	private readonly allItems: AutocompleteSelectItem[];
	private readonly noMatchText: string;
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

	constructor(options: AutocompleteSelectOptions, theme: any) {
		this.allItems = options.items;
		this.noMatchText = options.noMatchText ?? "  No matching items";

		this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.container.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 1, 0));
		this.container.addChild(this.input);
		this.container.addChild(new Text("", 0, 0));

		this.selectList = new SelectList(this.allItems, options.maxVisible ?? 10, {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.bg("selectedBg", theme.fg("accent", text)),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text.replace("No matching commands", this.noMatchText.trim())),
		});
		this.selectList.onSelect = (item) => this.onSelect?.(item);
		this.selectList.onCancel = () => this.onCancel?.();
		this.container.addChild(this.selectList);
		this.container.addChild(new Text(theme.fg("dim", options.helpText ?? "Type to fuzzy filter • ↑↓ navigate • enter select • esc cancel"), 1, 0));
		this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	handleInput(data: string): void {
		const before = this.input.getValue();
		this.selectList.handleInput(data);
		this.input.handleInput(data);
		const after = this.input.getValue();
		if (after !== before) {
			this.applyFilter(after);
		}
	}

	invalidate(): void {
		this.container.invalidate();
	}

	private applyFilter(query: string): void {
		const matches = fuzzyFilter(this.allItems, query, (item) => `${item.label} ${item.value} ${item.description ?? ""}`);
		this.selectList.setFilter("");
		// SelectList only supports prefix filtering natively, so replace its private backing arrays through its public constructor shape.
		(this.selectList as any).filteredItems = matches;
		this.selectList.setSelectedIndex(0);
	}
}

export async function autocompleteSelect(ctx: any, options: AutocompleteSelectOptions): Promise<string | undefined> {
	const custom = ctx.ui.custom as (factory: (tui: any, theme: any, keybindings: any, done: (value: string | undefined) => void) => Component) => Promise<string | undefined>;
	return custom((tui: any, theme: any, _keybindings: any, done: (value: string | undefined) => void) => {
		const component = new AutocompleteSelect(options, theme);
		component.onSelect = (item) => done(item.value);
		component.onCancel = () => done(undefined);
		return {
			get focused() {
				return component.focused;
			},
			set focused(value: boolean) {
				component.focused = value;
			},
			render: (width: number) => component.render(width),
			invalidate: () => component.invalidate(),
			handleInput: (data: string) => {
				component.handleInput(data);
				tui.requestRender();
			},
		};
	});
}
