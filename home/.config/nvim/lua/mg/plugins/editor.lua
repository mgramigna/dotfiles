return {
	{ "lukas-reineke/indent-blankline.nvim", main = "ibl", opts = {} },
	{ "tpope/vim-sleuth" },
	{ "christoomey/vim-tmux-navigator" },
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
