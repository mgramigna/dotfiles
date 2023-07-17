return {
	{
		"tpope/vim-commentary",
		event = "BufReadPre",
	},
	{
		"tpope/vim-surround",
		event = "BufReadPre",
	},
	{
		"christoomey/vim-tmux-navigator",
	},
	{
		"folke/flash.nvim",
		event = "VeryLazy",
		opts = {},
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
}
