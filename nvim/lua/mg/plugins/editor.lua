return {
	{ "lukas-reineke/indent-blankline.nvim", main = "ibl", opts = {} },
	{ "tpope/vim-sleuth" },
	{
		"echasnovski/mini.pairs",
		event = "VeryLazy",
		opts = {},
	},
	{ "echasnovski/mini.ai", version = "*", opts = {} },
	{ "echasnovski/mini.surround", version = "*", opts = {} },
	{
		"echasnovski/mini.diff",
		version = "*",
		opts = {
			mappings = {
				goto_prev = "[c",
				goto_next = "]c",
			},
		},
		keys = {
			{
				"<leader>go",
				function()
					require("mini.diff").toggle_overlay(0)
				end,
				desc = "Toggle Diff View",
			},
		},
	},
	{
		"tpope/vim-commentary",
	},
	{ "christoomey/vim-tmux-navigator" },
	{
		"folke/flash.nvim",
		event = "VeryLazy",
		opts = {
			modes = {
				char = {
					enabled = false,
				},
			},
		},
		keys = {
			{
				"s",
				mode = { "n", "x", "o" },
				function()
					require("flash").jump()
				end,
				desc = "Flash",
			},
		},
	},
	{
		"forest-nvim/maple.nvim",
		opts = {
			keymaps = {
				toggle = "<leader>mt",
				close = "q",
				switch_mode = "m",
			},
		},
	},
}
