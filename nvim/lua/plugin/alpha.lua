return function()
	local dashboard = require("alpha.themes.dashboard")

	local default_header = {
		type = "text",
		val = {
			[[███    ██ ███████  ██████  ██    ██ ██ ███    ███]],
			[[████   ██ ██      ██    ██ ██    ██ ██ ████  ████]],
			[[██ ██  ██ █████   ██    ██ ██    ██ ██ ██ ████ ██]],
			[[██  ██ ██ ██      ██    ██  ██  ██  ██ ██  ██  ██]],
			[[██   ████ ███████  ██████    ████   ██ ██      ██]],
		},
		opts = {
			position = "center",
			hl = "Type",
		},
	}
	local buttons = {

		type = "group",
		val = {
			{ type = "text", val = "Quick links", opts = { hl = "SpecialComment", position = "center" } },
			{ type = "padding", val = 1 },
			dashboard.button("e", "  New file", "<cmd>ene<CR>"),
			dashboard.button("f", "  Find file", "<cmd>Telescope find_files<CR>"),
			dashboard.button("c", "  Configuration", "<cmd>:e $MYVIMRC | :cd %:p:h<CR>"),
			dashboard.button("u", "  Update plugins", "<cmd>PackerSync<CR>"),
			dashboard.button("q", "  Quit", "<cmd>qa<CR>"),
		},
		position = "center",
	}

	local config = {
		layout = {
			{ type = "padding", val = 4 },
			default_header,
			{ type = "padding", val = 2 },
			buttons,
			{ type = "padding", val = 2 },
		},
	}

	require("alpha").setup(config)
end
