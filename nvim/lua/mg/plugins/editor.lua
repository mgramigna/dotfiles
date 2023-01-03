return {
	"tpope/vim-commentary",
	"tpope/vim-surround",
	{
		"ggandor/leap.nvim",
		config = function()
			require("leap").set_default_keymaps()
		end,
	},
}
