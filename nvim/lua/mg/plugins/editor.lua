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
		"ggandor/leap.nvim",
		event = "BufReadPre",
		config = function()
			require("leap").set_default_keymaps()
		end,
	},
	{
		"christoomey/vim-tmux-navigator",
	},
}
