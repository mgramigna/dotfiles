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
		"tpope/vim-commentary",
		event = "BufReadPre",
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
			{
				"R",
				mode = { "o", "x" },
				function()
					require("flash").treesitter_search()
				end,
				desc = "Flash Treesitter Search",
			},
		},
	},
	{
		"magicduck/grug-far.nvim",
		cmd = "GrugFar",
		config = function()
			require("grug-far").setup({})
		end,
	},
}
